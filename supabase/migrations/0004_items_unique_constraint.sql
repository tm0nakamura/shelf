-- Replace the partial unique INDEX with a real UNIQUE CONSTRAINT so
-- ON CONFLICT (user_id, source, external_id) actually resolves.
--
-- The previous partial index (WHERE external_id IS NOT NULL) is not
-- usable as an ON CONFLICT arbiter through PostgREST: PostgREST has no
-- way to attach the matching WHERE predicate to its INSERT, so PG
-- raises 42P10 "no unique or exclusion constraint matching ON CONFLICT".
--
-- A plain UNIQUE constraint (NULLS DISTINCT, the default) keeps the
-- same effective behavior — rows with NULL external_id never collide
-- because NULLs are treated as distinct — while being a valid arbiter.

drop index if exists public.items_external_unique;

alter table public.items
  add constraint items_external_unique
  unique (user_id, source, external_id);
