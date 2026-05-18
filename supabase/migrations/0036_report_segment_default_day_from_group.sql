-- Relative delivery dates, fix: unlinked report default day
--
-- migration 0035 computed a report segment's default day from a 3-branch
-- coalesce: (1) min effective day of its TRIGGERING letters, then (2) min
-- effective day of EVERY letter in the parent letter group, then (3) the
-- letter group's own delivery day. Branch (2) is wrong for a report that
-- isn't linked to any action: when the group's letters carry their own
-- positive offsets, min(letter day) lands a day or more past the group
-- day, so an unlinked report drifted to group_day + 2 (or later) instead
-- of group_day + 1.
--
-- The intended rule (and what the inspector panel already computes) is:
--   default report day = (triggering letter min effective day, or the
--   letter group's delivery day when there are no triggers) + 1.
-- This migration recreates report_segments_view with branch (2) dropped.

drop view if exists public.report_segments_view;
create view public.report_segments_view as
select
  rs.*,
  rg.letter_group_id,
  lg.storyline_id,
  sl.abbreviation as storyline_abbreviation,
  lg.sequence as group_sequence,
  'R-' || sl.abbreviation || lg.sequence::text || '/' || rs.variant as report_id,
  case
    when rs.delivery_day_override_id is not null then rs.delivery_day_override_id
    else (
      select d.id
      from public.days d
      where d.number = (
        coalesce(
          (
            select min(d_il.number)
            from public.actions a
            join public.inspection_letters_view ilv on ilv.id = a.inspection_letter_id
            join public.days d_il on d_il.id = ilv.effective_day_id
            where a.report_segment_id = rs.id
          ),
          (
            select d_lg.number
            from public.days d_lg
            where d_lg.id = lg.delivery_day_id
          )
        ) + 1 + coalesce(rs.delivery_day_offset, 0)
      )
    )
  end as effective_day_id
from public.report_segments rs
join public.report_groups rg on rg.id = rs.report_group_id
join public.letter_groups lg on lg.id = rg.letter_group_id
join public.storylines sl on sl.id = lg.storyline_id;
