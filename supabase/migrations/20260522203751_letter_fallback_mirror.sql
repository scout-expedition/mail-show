-- Letter fallback (mirror-only): adds a nullable pointer on inspection_letters
-- to one of the letter's own actions. NULL = no fallback, set = mirror that
-- action's behavior when the player doesn't choose. FK `on delete set null`
-- gives auto-revert when the mirrored action is deleted; a trigger enforces
-- that the pointer can only target an action on this same letter.

alter table public.inspection_letters
  add column if not exists fallback_mirror_action_id uuid
    references public.actions(id) on delete set null;

create or replace function public.inspection_letters_validate_fallback_mirror()
  returns trigger language plpgsql as $$
declare row_letter uuid;
begin
  if new.fallback_mirror_action_id is null then return new; end if;
  select inspection_letter_id into row_letter
    from public.actions where id = new.fallback_mirror_action_id;
  if row_letter is null or row_letter <> new.id then
    raise exception 'fallback_mirror_action_id must reference an action on this letter';
  end if;
  return new;
end $$;

drop trigger if exists inspection_letters_validate_fallback_mirror
  on public.inspection_letters;
create trigger inspection_letters_validate_fallback_mirror
  before insert or update on public.inspection_letters
  for each row execute function public.inspection_letters_validate_fallback_mirror();

-- Rebuild inspection_letters_view so the new column is exposed to the app.
-- The view's column list is snapshotted at CREATE time even with `il.*`, so
-- the drop+recreate is required. report_segments_view depends on
-- inspection_letters_view, so it must be dropped+recreated too. Shapes
-- mirror 0034 (inspection_letters_view) and
-- 20260519181503_report_segment_default_day_from_group.sql (report_segments_view).
drop view if exists public.report_segments_view;
drop view if exists public.inspection_letters_view;
create view public.inspection_letters_view as
select
  il.*,
  case
    when il.delivery_day_override_id is not null then il.delivery_day_override_id
    when il.delivery_day_offset is not null then (
      select d.id
      from public.days d
      where d.number = (
        select d_lg.number from public.days d_lg where d_lg.id = lg.delivery_day_id
      ) + il.delivery_day_offset
    )
    else lg.delivery_day_id
  end as effective_day_id,
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
