-- Shorten the inspection-letter content id prefix from "IL-" to "L-".
-- The id is a derived string produced by the inspection_letters_view; no
-- underlying data changes. Drop/recreate the view so the new formula
-- takes effect.

drop view if exists public.inspection_letters_view;
create or replace view public.inspection_letters_view as
select
  il.*,
  coalesce(il.delivery_day_override_id, lg.delivery_day_id) as effective_day_id,
  sl.abbreviation as storyline_abbreviation,
  lg.sequence as group_sequence,
  sl.id as storyline_id,
  'L-' ||
    sl.abbreviation ||
    lg.sequence::text ||
    case when il.variant is not null then '/' || il.variant else '' end ||
    case when il.piece is not null and il.piece <> 0 then il.piece::text else '' end
    as content_id
from public.inspection_letters il
join public.letter_groups lg on lg.id = il.letter_group_id
join public.storylines sl on sl.id = lg.storyline_id;
