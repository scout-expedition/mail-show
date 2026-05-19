-- Add icon_type + icon_value to the nations table. The columns have
-- existed in the live dev DB for some time (added ad-hoc via the
-- Supabase SQL editor) and are read/written by the nations editor +
-- inspector. This migration codifies them so `supabase db reset` (which
-- CI uses) produces a schema that matches production.
--
-- Idempotent: `add column if not exists` so re-running against a
-- populated DB is safe.

alter table public.nations
  add column if not exists icon_type public.icon_type not null default 'lucide',
  add column if not exists icon_value text;
