-- Allow connections to exist without server-side credentials. This is
-- the schema half of the U-NEXT pass-through redesign: cookies live in
-- the user's browser localStorage, the server only sees them while a
-- single sync request is in flight, and the connection row in the DB
-- is just a "this user has set up U-NEXT" marker.

alter table public.connections
  alter column credentials_encrypted drop not null;
