-- Loosen connections.provider from a hard-coded enum to free text. Lets
-- us add per-service scrapers (jumpplus, filmarks, …) without a
-- migration each time. App-layer zod is the gate.

alter table public.connections drop constraint if exists connections_provider_check;
