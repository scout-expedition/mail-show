-- Make the sorting_rules.letter unique constraint DEFERRABLE INITIALLY
-- DEFERRED so a single UPDATE statement can swap letters between rules
-- (e.g. rule A→B while rule B→A) without tripping the constraint on the
-- first row rewritten. The new `apply_rule_letters` RPC relies on this:
-- it does the whole permutation in one UPDATE and lets Postgres validate
-- the final state at commit time.

alter table public.sorting_rules
  drop constraint if exists sorting_rules_letter_key;
alter table public.sorting_rules
  add constraint sorting_rules_letter_key unique (letter)
  deferrable initially deferred;
