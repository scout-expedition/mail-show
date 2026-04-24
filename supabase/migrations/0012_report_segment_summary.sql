-- Report segments now carry an optional summary alongside their full
-- content body, mirroring how inspection_letters already do. The graph
-- view shows the summary as a body box under the report's pill heading,
-- and the inspection workspace exposes it as an editable input.

alter table public.report_segments
  add column if not exists summary text;

-- Views select * from the base table, which snapshots the column list at
-- creation time. Drop and recreate so summary flows through.
drop view if exists public.report_segments_view;
create view public.report_segments_view as
select
  rs.*,
  rg.letter_group_id,
  lg.storyline_id,
  sl.abbreviation as storyline_abbreviation,
  lg.sequence as group_sequence,
  'R-' || sl.abbreviation || lg.sequence::text || '/' || rs.variant as report_id,
  coalesce(
    rs.delivery_day_override_id,
    (
      select d_next.id from public.days d_next
      where d_next.number = (
        coalesce(
          (select min(d_trig.number)
            from public.inspection_letters il2
            join public.days d_trig on d_trig.id = il2.delivery_day_override_id
            where il2.letter_group_id = rg.letter_group_id),
          (select d_lg.number from public.days d_lg where d_lg.id = lg.delivery_day_id)
        ) + 1
      )
    )
  ) as effective_day_id
from public.report_segments rs
join public.report_groups rg on rg.id = rs.report_group_id
join public.letter_groups lg on lg.id = rg.letter_group_id
join public.storylines sl on sl.id = lg.storyline_id;
