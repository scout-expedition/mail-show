-- Add updated_by to tables that don't have it yet so delete actions can
-- stamp the deleter's email before removing the row. Supabase realtime
-- sends the full old row (REPLICA IDENTITY FULL) on DELETE, so the client
-- reads updated_by out of the payload to show a named attribution toast
-- instead of the generic "Someone deleted …" fallback.

alter table public.letter_groups
  add column if not exists updated_by text;

alter table public.sorting_letters
  add column if not exists updated_by text;

alter table public.sorting_rules
  add column if not exists updated_by text;

alter table public.cities
  add column if not exists updated_by text;

alter table public.nations
  add column if not exists updated_by text;

alter table public.citizens
  add column if not exists updated_by text;
