-- Flip the stamp column's polarity: `is_counterfeit` (true = fake) becomes
-- `stamp_valid` (true = the stamp is valid, false = fake). The rule_target enum
-- value is renamed alongside it so rule conditions keep pointing at the column.
--
-- Existing rule conditions have their true/false reference flipped BEFORE the
-- rename, while the target is still spelled `is_counterfeit` — that preserves
-- authored intent through the polarity change for both `is` and `is_not`
-- ("is_counterfeit is true" meant fake, and "stamp_valid is false" still does).
--
-- Idempotent: the data + column work is guarded on the old column still being
-- present, and the enum rename on the old label still existing (ALTER TYPE ...
-- RENAME VALUE has no IF EXISTS).

-- ── data + column ────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sorting_letters'
      and column_name = 'is_counterfeit'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sorting_letters'
      and column_name = 'stamp_valid'
  ) then
    update public.sorting_rule_conditions
      set reference_type = (case reference_type
        when 'true' then 'false'
        else 'true'
      end)::public.rule_reference_type
      where target = 'is_counterfeit'
        and reference_type in ('true', 'false');

    update public.sorting_letters set is_counterfeit = not is_counterfeit;

    alter table public.sorting_letters
      rename column is_counterfeit to stamp_valid;

    alter table public.sorting_letters
      alter column stamp_valid set default true;
  end if;
end $$;

-- ── enum label ───────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'rule_target' and e.enumlabel = 'is_counterfeit'
  ) then
    alter type public.rule_target rename value 'is_counterfeit' to 'stamp_valid';
  end if;
end $$;

-- ── view ─────────────────────────────────────────────────────────────────
-- The view selects sl.*, so the renamed column renames a view column too.
-- CREATE OR REPLACE VIEW cannot rename an output column — drop and recreate.
-- DROP VIEW also drops its grants, so they are re-issued below.
drop view if exists public.sorting_letters_view;

create view public.sorting_letters_view as
select
  sl.*,
  d.number as day_number,
  'S' || d.number::text || '-' || lpad(sl.sort_id::text, 2, '0') as content_id
from public.sorting_letters sl
join public.days d on d.id = sl.day_id;

grant select on public.sorting_letters_view to authenticated, service_role;
