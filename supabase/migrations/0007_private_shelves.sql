-- Lock the shelf down to its owner. Phase 3 of the privacy hardening:
-- Phase 1 was moving U-NEXT cookies to localStorage; this drops the
-- public-read RLS policies so a logged-in user can only ever see
-- their own profile / events / items, and an unauthenticated visitor
-- sees nothing at all.
--
-- The /u/[username] route still works for the owner (users_self and
-- items_self cover SELECT for auth.uid() = user_id) but third parties
-- get a notFound() because the SELECT on users itself returns 0 rows
-- through RLS.
--
-- A future migration will reintroduce opt-in public sharing via a
-- users.shelf_public flag; for now we close the door.

drop policy if exists users_public_profile on public.users;
drop policy if exists events_public_read on public.events;
drop policy if exists items_public_read on public.items;
