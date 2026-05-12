-- Endings frameworks Phase 4: aggregate variable kinds.
--
-- Today authors can branch on either a hand-defined `text` variable or a
-- `number_ref` (one of the 10 impact-column scores). This migration adds a
-- third kind — `aggregate_ref` — that picks the argmax/argmin of a small
-- fixed score set:
--
--   * class_affinity  — argmax/argmin over { proletariat, gentry }
--   * nation_affinity — argmax/argmin over { folos, emberlyn, spokgrad,
--                       pelico, epicenter }
--
-- Authoring shape: `[Class Affinity] [top is] [Working Class]`. New
-- operators top=/top≠/bottom=/bottom≠ live alongside the existing six.
-- Tiebreakers are intentionally TBD — for now ties produce no match.
--
-- Idempotent-friendly per project convention. Re-runs against an
-- already-migrated DB are safe.
--
-- Underlying impact-column rows are seeded by 0016/0019; this migration
-- only adds the two aggregate variables on top.

-- 1) Variables: add aggregate_ref column.
alter table public.ending_variables
  add column if not exists aggregate_ref text;

-- 2) Drop every existing CHECK on ending_variables that mentions `kind`,
--    then re-add a wider kind CHECK + cohesion CHECK + aggregate_ref CHECK.
--    The original column-inline `check (kind in ('text','number_ref'))` from
--    0014 is auto-named, so we have to look up its name.
do $$
declare
  con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    where r.relname = 'ending_variables'
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%kind%'
        or pg_get_constraintdef(c.oid) ilike '%aggregate_ref%'
      )
  loop
    execute format('alter table public.ending_variables drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.ending_variables
  add constraint ending_variables_kind_check
    check (kind in ('text','number_ref','aggregate_ref'));

alter table public.ending_variables
  add constraint ending_variables_kind_shape
    check (
      (kind = 'text'           and number_ref is null and aggregate_ref is null)
      or (kind = 'number_ref'    and number_ref is not null and aggregate_ref is null)
      or (kind = 'aggregate_ref' and number_ref is null     and aggregate_ref is not null)
    );

alter table public.ending_variables
  add constraint ending_variables_aggregate_ref_check
    check (
      aggregate_ref is null
      or aggregate_ref in ('class_affinity','nation_affinity')
    );

-- 3) Chips: add aggregate_value column + widen operator CHECK + reshape
--    the value-shape CHECK so each chip carries exactly one payload.
alter table public.ending_condition_row_chips
  add column if not exists aggregate_value text;

do $$
declare
  con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    where r.relname = 'ending_condition_row_chips'
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%operator%'
        or pg_get_constraintdef(c.oid) ilike '%text_value_id%'
      )
  loop
    execute format(
      'alter table public.ending_condition_row_chips drop constraint %I',
      con.conname
    );
  end loop;
end $$;

alter table public.ending_condition_row_chips
  add constraint ending_condition_row_chips_operator_check
    check (
      operator in (
        '=','≠','<','≤','>','≥',
        'top=','top≠','bottom=','bottom≠'
      )
    );

alter table public.ending_condition_row_chips
  add constraint ending_condition_row_chips_value_shape
    check (
      (text_value_id   is not null and number_value is null     and aggregate_value is null)
      or (number_value    is not null and text_value_id is null    and aggregate_value is null)
      or (aggregate_value is not null and text_value_id is null    and number_value    is null)
    );

-- 4) Auto-seed Class Affinity + Nation Affinity, deterministic uuid_v5
--    on the same namespace as 0016.
do $$
declare
  ns uuid := '0e3f1c00-0000-0000-0000-000000000000';
begin
  insert into public.ending_variables
    (id, name, kind, aggregate_ref, color_index, sort_order)
  values
    (
      uuid_generate_v5(ns, 'class_affinity'),
      'Class Affinity',
      'aggregate_ref',
      'class_affinity',
      2,
      11000
    ),
    (
      uuid_generate_v5(ns, 'nation_affinity'),
      'Nation Affinity',
      'aggregate_ref',
      'nation_affinity',
      5,
      11001
    )
  on conflict (id) do nothing;
end $$;
