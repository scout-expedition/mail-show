-- Manual ordering for the rules list. Initial value matches the rule's
-- letter (A=0, B=1, ...), so existing rules keep their alphabetical order
-- until the user drags or renumbers. New rules pick MAX(sort_order) + 1 in
-- the createRule action.

alter table public.sorting_rules
  add column if not exists sort_order int not null default 0;

update public.sorting_rules
  set sort_order = ascii(letter) - ascii('A')
  where sort_order = 0;

create index if not exists sorting_rules_sort_order_idx
  on public.sorting_rules (sort_order);
