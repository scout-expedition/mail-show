-- letter_groups.sort_order — list order, independent of the display-ID `sequence`.
-- Before this, `sequence` doubled as both the display ID and the implicit sort
-- order, so reordering groups silently renumbered every letter/report ID.
-- `sort_order` is intentionally NOT unique (a unique constraint would force a
-- temp-park dance on every drag); `sequence` keeps UNIQUE(storyline_id, sequence).

alter table public.letter_groups
  add column if not exists sort_order int not null default 0;

-- Backfill: existing lists keep rendering unchanged (sort_order mirrors sequence).
update public.letter_groups
  set sort_order = sequence
  where sort_order = 0;

create index if not exists letter_groups_storyline_sort_idx
  on public.letter_groups(storyline_id, sort_order);
