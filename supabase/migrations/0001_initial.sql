-- Phase 1 schema: users / connections / items / events / sync_logs / wallpapers
-- Run with: supabase db push  (or psql -f for raw)

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------
-- users
-- Linked 1:1 to auth.users via id.
-- ----------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  username text not null unique,
  display_name text not null,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  theme text not null default 'ami',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_username_idx on public.users (username);

-- ----------------------------------------------------------------
-- connections
-- One row per (user, provider). credentials is jsonb encrypted via pgcrypto.
-- ----------------------------------------------------------------
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('spotify', 'gmail')),
  auth_type text not null default 'oauth',
  credentials_encrypted bytea not null,
  status text not null default 'active' check (status in ('active', 'expired', 'error', 'revoked')),
  last_synced_at timestamptz,
  next_sync_at timestamptz,
  error_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index connections_user_id_idx on public.connections (user_id);
create index connections_next_sync_idx on public.connections (next_sync_at) where status = 'active';

-- ----------------------------------------------------------------
-- events (live / fanmeeting etc.)
-- ----------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  event_date date not null,
  venue text,
  event_type text check (event_type in ('live', 'play', 'fanmeeting', 'release_event', 'other')),
  created_at timestamptz not null default now()
);

create index events_user_id_idx on public.events (user_id, event_date desc);

-- ----------------------------------------------------------------
-- items
-- Main shelf entity. category covers 6 buckets.
-- ----------------------------------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  source text not null check (source in (
    'spotify_recent', 'spotify_saved',
    'gmail_amazon', 'gmail_eplus',
    'share_sheet', 'url', 'image_upload', 'manual', 'barcode'
  )),
  connection_id uuid references public.connections(id) on delete set null,
  category text not null check (category in (
    'music', 'book', 'film', 'comic', 'live_event', 'game'
  )),
  external_id text,
  title text not null,
  creator text,
  cover_image_url text,
  image_urls jsonb,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  price_jpy int,
  acquired_at timestamptz,
  consumed_at timestamptz,
  added_at timestamptz not null default now()
);

create unique index items_external_unique
  on public.items (user_id, source, external_id)
  where external_id is not null;

create index items_user_category_added_idx
  on public.items (user_id, category, added_at desc);

create index items_user_source_added_idx
  on public.items (user_id, source, added_at desc);

create index items_user_added_idx
  on public.items (user_id, added_at desc);

-- ----------------------------------------------------------------
-- sync_logs
-- ----------------------------------------------------------------
create table public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('success', 'partial', 'failed')),
  items_added int not null default 0,
  items_updated int not null default 0,
  items_failed int not null default 0,
  error_message text,
  error_detail jsonb
);

create index sync_logs_connection_idx on public.sync_logs (connection_id, started_at desc);

-- ----------------------------------------------------------------
-- wallpapers (Phase 3 — table reserved up front)
-- ----------------------------------------------------------------
create table public.wallpapers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  device_size text not null check (device_size in ('iphone_pro_max', 'square', 'landscape')),
  image_url text not null,
  item_ids uuid[] not null default '{}',
  generated_at timestamptz not null default now(),
  downloaded_at timestamptz
);

create index wallpapers_user_idx on public.wallpapers (user_id, generated_at desc);

-- ----------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------
alter table public.users enable row level security;
alter table public.connections enable row level security;
alter table public.events enable row level security;
alter table public.items enable row level security;
alter table public.sync_logs enable row level security;
alter table public.wallpapers enable row level security;

create policy users_self on public.users
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy users_public_profile on public.users
  for select using (true);  -- shelf URL needs public read by username

create policy connections_self on public.connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy events_self on public.events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy events_public_read on public.events
  for select using (true);

create policy items_self on public.items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy items_public_read on public.items
  for select using (true);

create policy sync_logs_self on public.sync_logs
  for select using (
    exists (
      select 1 from public.connections c
      where c.id = connection_id and c.user_id = auth.uid()
    )
  );

create policy wallpapers_self on public.wallpapers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------
-- Helper: bootstrap public.users row from auth.users
-- Triggered on auth signup.
-- ----------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
declare
  base_handle text;
  generated_handle text;
  attempt int := 0;
begin
  base_handle := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9]', '', 'g'));
  if base_handle = '' or base_handle is null then
    base_handle := 'user';
  end if;
  generated_handle := base_handle;

  -- Resolve unique handle by suffixing a random number on conflict.
  while exists (select 1 from public.users where username = generated_handle) loop
    attempt := attempt + 1;
    generated_handle := base_handle || floor(random() * 10000)::int;
    if attempt > 20 then
      generated_handle := base_handle || extract(epoch from now())::bigint;
      exit;
    end if;
  end loop;

  insert into public.users (id, email, username, display_name)
  values (new.id, new.email, generated_handle, coalesce(new.raw_user_meta_data ->> 'name', generated_handle));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
