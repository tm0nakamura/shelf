-- Loosen items.source from a hard-coded enum to free text.
-- Any source label is now valid; the application layer (zod) is the gate.
-- This unblocks per-service scrapers (scrape_jumpplus, scrape_filmarks, …)
-- without needing a migration each time.

alter table public.items drop constraint if exists items_source_check;
