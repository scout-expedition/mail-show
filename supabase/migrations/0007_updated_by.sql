-- Track which user last edited inspection letters and report segments, so
-- the letter/report panels in /inspection/letters can show a
-- "Last updated {when} by {who}" footer. We store the email (Supabase
-- `auth.users.email`) rather than a user id so display is cheap and
-- robust to missing auth rows.

alter table public.inspection_letters
  add column if not exists updated_by text;

alter table public.report_segments
  add column if not exists updated_by text;

-- Views select * from the base tables, which snapshots the column list at
-- creation time. Drop and recreate so updated_by flows through.
drop view if exists public.inspection_letters_view;
create view public.inspection_letters_view as
select
  il.*,
  coalesce(il.delivery_day_override_id, lg.delivery_day_id) as effective_day_id,
  sl.abbreviation as storyline_abbreviation,
  lg.sequence as group_sequence,
  sl.id as storyline_id,
  'IL-' ||
    sl.abbreviation ||
    lg.sequence::text ||
    case when il.variant is not null then '/' || il.variant else '' end ||
    case when il.piece is not null and il.piece <> 0 then il.piece::text else '' end
    as content_id
from public.inspection_letters il
join public.letter_groups lg on lg.id = il.letter_group_id
join public.storylines sl on sl.id = lg.storyline_id;

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
