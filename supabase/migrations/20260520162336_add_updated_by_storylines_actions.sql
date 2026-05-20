-- Add updated_by to tables that don't have it yet so delete actions and
-- last-updated footers can show a named attribution. Mirrors the pattern in
-- 0040_updated_by_delete_attribution.sql.

alter table public.storylines
  add column if not exists updated_by text;

alter table public.actions
  add column if not exists updated_by text;
