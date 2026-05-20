-- 0042_sorting_rules_revamp.sql
--
-- Schema changes for the sorting rules page revamp:
--   * migrate legacy whole-name condition targets onto the first-name targets
--   * remove the 3-condition cap (keep a position >= 1 floor)
--   * add day_cancelled_id and routes_to_reporting to sorting_rules
--
-- Depends on 0041 (uses the rule_target name-part values). The preflight guard
-- raises a clear error if 0041 has not been applied. Idempotent.

-- ── preflight: 0041 must have run ────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'rule_target' and e.enumlabel = 'sender_first_name'
  ) then
    raise exception
      '0042 requires 0041: the rule_target enum is missing the name-part values';
  end if;
end $$;

-- ── migrate legacy whole-name condition targets ──────────────────────────
-- The closest single-field equivalent of a whole-name match is the first name.
update public.sorting_rule_conditions set target = 'sender_first_name'
where target = 'sender_name';
update public.sorting_rule_conditions set target = 'recipient_first_name'
where target = 'recipient_name';

-- ── unlimited conditions: replace the 1..3 cap with a >= 1 floor ─────────
-- Drop whatever check constraint currently guards `position` (named
-- sorting_rule_conditions_position_check by default), then re-add a
-- floor-only check. UNIQUE (rule_id, position) is separate, left intact.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.sorting_rule_conditions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%position%'
  loop
    execute format(
      'alter table public.sorting_rule_conditions drop constraint %I', c);
  end loop;
end $$;
alter table public.sorting_rule_conditions
  add constraint sorting_rule_conditions_position_check check (position >= 1);

-- ── sorting_rules: day cancelled + reporting destination ─────────────────
alter table public.sorting_rules add column if not exists day_cancelled_id uuid
  references public.days(id) on delete set null;
alter table public.sorting_rules add column if not exists routes_to_reporting
  boolean not null default false;

-- The destination is a three-way choice — unset, a numeric slot, or
-- Reporting — so routes_to_reporting and destination_slot are mutually
-- exclusive.
alter table public.sorting_rules
  drop constraint if exists sorting_rules_destination_exclusive;
alter table public.sorting_rules
  add constraint sorting_rules_destination_exclusive
  check (not (routes_to_reporting and destination_slot is not null));
