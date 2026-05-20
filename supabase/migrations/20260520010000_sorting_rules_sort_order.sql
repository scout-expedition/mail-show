-- Manual ordering for the rules list. Initial value matches the rule's
-- letter (A=0, B=1, ...), so existing rules keep their alphabetical order
-- until the user drags or renumbers. New rules pick MAX(sort_order) + 1 in
-- the createRule action.

alter table public.sorting_rules
  add column if not exists sort_order int not null default 0;

-- Idempotent backfill: only runs when every row is still at the default 0
-- (i.e. nobody has reordered yet). Once any row has a non-zero sort_order
-- the user has manually arranged something, and re-running this migration
-- must NOT clobber that order back to alphabetical.
update public.sorting_rules
  set sort_order = ascii(letter) - ascii('A')
  where not exists (
    select 1 from public.sorting_rules where sort_order <> 0
  );

create index if not exists sorting_rules_sort_order_idx
  on public.sorting_rules (sort_order);
