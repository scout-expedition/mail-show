-- Single-letter groups now store variant = 'a' (not null), so actions can
-- stably reference them via next_letter_variant. The view hides the "/a"
-- suffix in content_id when a group has only one letter, so the display
-- stays "L-U3" rather than "L-U3/a".

update public.inspection_letters il
set variant = 'a'
where il.variant is null
  and (
    select count(*) from public.inspection_letters il2
    where il2.letter_group_id = il.letter_group_id
  ) = 1;

drop view if exists public.inspection_letters_view;
create view public.inspection_letters_view as
select
  il.*,
  coalesce(il.delivery_day_override_id, lg.delivery_day_id) as effective_day_id,
  sl.abbreviation as storyline_abbreviation,
  lg.sequence as group_sequence,
  sl.id as storyline_id,
  'L-' ||
    sl.abbreviation ||
    lg.sequence::text ||
    case
      when gc.n > 1 and il.variant is not null then '/' || il.variant
      else ''
    end ||
    case when il.piece is not null and il.piece <> 0 then il.piece::text else '' end
    as content_id
from public.inspection_letters il
join public.letter_groups lg on lg.id = il.letter_group_id
join public.storylines sl on sl.id = lg.storyline_id
left join (
  select letter_group_id, count(*) as n
  from public.inspection_letters
  group by letter_group_id
) gc on gc.letter_group_id = il.letter_group_id;
