-- Endings logic v2: dedicated "Tiebreak Set" aggregate_ref variable.
--
-- Previously the seeded "Nation Affinity" aggregate_ref variable
-- carried both the score-based (top= / bottom=) and the set-narrowing
-- (set_includes / set_excludes) operators. The dual-purpose variable
-- was confusing in the chip picker: authors would see one row labeled
-- "Nation Affinity" and have to remember which operator meant which
-- semantic. This migration adds a new aggregate_ref value
-- `nation_tiebreak_set` and seeds a separate variable named
-- "Tiebreak Set" that's the obvious home for the set-narrowing chips.
--
-- The chip operator picker filters by aggregate_ref:
--   - nation_affinity     → top/bottom only
--   - nation_tiebreak_set → set_includes / set_excludes only
--   - class_affinity      → top/bottom only (unchanged)
--
-- Idempotent-friendly per project convention.

-- 1) Widen the aggregate_ref CHECK to include 'nation_tiebreak_set'.
alter table public.ending_variables
  drop constraint if exists ending_variables_aggregate_ref_check;

alter table public.ending_variables
  add constraint ending_variables_aggregate_ref_check
    check (
      aggregate_ref is null
      or aggregate_ref in (
        'class_affinity',
        'nation_affinity',
        'nation_tiebreak_set'
      )
    );

-- 2) Seed the new "Tiebreak Set" variable. Same uuid_v5 namespace as
--    0020 + 0016 so re-running the migration is a no-op.
do $$
declare
  ns uuid := '0e3f1c00-0000-0000-0000-000000000000';
begin
  insert into public.ending_variables
    (id, name, kind, aggregate_ref, color_index, sort_order)
  values
    (
      uuid_generate_v5(ns, 'nation_tiebreak_set'),
      'Tiebreak Set',
      'aggregate_ref',
      'nation_tiebreak_set',
      6,
      11002
    )
  on conflict (name) do nothing;
end $$;
