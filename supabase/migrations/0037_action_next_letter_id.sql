-- Next-letter linking, proper model: actions.next_letter_id
--
-- The old model stored `next_letter_variant char(1)` and resolved the
-- target letter implicitly within "the next group" (smallest sequence
-- greater than the source group). That forbids linking to anything but
-- the immediately-following group, and a bare variant char can't name a
-- letter when a day holds more than one group.
--
-- This adds a direct FK to the target letter. `on delete set null` makes
-- the link self-healing — deleting the target letter clears the ref, so
-- the orphan-sweep code that previously chased dangling variant chars is
-- no longer needed.
--
-- `next_letter_variant` is intentionally KEPT for now (this migration is
-- non-destructive); a later migration drops it once the new column has
-- been exercised.

alter table public.actions
  add column if not exists next_letter_id uuid
  references public.inspection_letters(id) on delete set null;

-- Backfill: resolve each existing next_letter_variant against the old
-- "next group by sequence" rule and store the concrete letter id. Picks
-- the lowest-piece letter row of the matching variant.
with resolved as (
  select
    a.id as action_id,
    (
      select il2.id
      from public.inspection_letters il2
      join public.letter_groups lg2 on lg2.id = il2.letter_group_id
      where lg2.storyline_id = lg.storyline_id
        and lg2.sequence > lg.sequence
        and il2.variant = a.next_letter_variant
      order by lg2.sequence asc, il2.piece asc nulls first
      limit 1
    ) as letter_id
  from public.actions a
  join public.inspection_letters il on il.id = a.inspection_letter_id
  join public.letter_groups lg on lg.id = il.letter_group_id
  where a.next_letter_variant is not null
)
update public.actions a
set    next_letter_id = resolved.letter_id
from   resolved
where  a.id = resolved.action_id
  and  resolved.letter_id is not null;

do $$
declare
  variant_set int;
  id_set      int;
begin
  select count(*) into variant_set
    from public.actions where next_letter_variant is not null;
  select count(*) into id_set
    from public.actions where next_letter_id is not null;
  raise notice '0037 actions next-letter backfill: variant_set=% id_set=%',
    variant_set, id_set;
end$$;
