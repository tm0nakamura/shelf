-- Loosen items.category from a hard-coded enum to free text. Lets us
-- introduce anime / drama (and future buckets like 'tv', 'doc') without
-- a migration each time. App-layer + UI are the gate.

alter table public.items drop constraint if exists items_category_check;
