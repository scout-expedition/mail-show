-- Endings logic v2: set-narrowing tiebreak operators.
--
-- Adds two new chip operators — `set_includes` and `set_excludes` —
-- to the chip CHECK constraint. They're only meaningful inside a
-- nation tiebreak doc evaluated with set-narrowing semantics, where
-- the evaluator threads a mutable working set; outside that context
-- the evaluator returns false. Authors attach them to the seeded
-- `Nation Affinity` aggregate_ref variable to gate condition rows on
-- "is this nation still in the running?" without consulting score
-- columns.
--
-- The new `__remove__:<nation>` and `__random_remaining__` result
-- sentinels live in the existing `result_value` text column; no
-- schema change is needed for those.
--
-- Idempotent-friendly per project convention.

do $$
declare con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    where r.relname = 'ending_condition_row_chips'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%top=%'
      and pg_get_constraintdef(c.oid) not ilike '%set_includes%'
  loop
    execute format(
      'alter table public.ending_condition_row_chips drop constraint %I',
      con.conname
    );
  end loop;
end $$;

alter table public.ending_condition_row_chips
  drop constraint if exists ending_condition_row_chips_operator_check;
alter table public.ending_condition_row_chips
  add constraint ending_condition_row_chips_operator_check
    check (operator in (
      '=','≠','<','≤','>','≥',
      'top=','top≠','bottom=','bottom≠',
      'set_includes','set_excludes'
    ));
