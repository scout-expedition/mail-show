-- Relative delivery dates, Phase 2: report segments
--
-- Adds a positive `delivery_day_offset` to report_segments so per-segment
-- overrides can be expressed as a delta from the report's default day, which
-- is `min(triggering letter effective day) + 1`. Existing absolute pins are
-- auto-converted to offsets where the resulting offset is >= 1; sub-default
-- pins (target day earlier than the default report day) keep their absolute
-- pin. The CHECK constraint enforces mutual exclusion with override_id and
-- the >=1 floor going forward.
--
-- The view recomputation reads through inspection_letters_view so the
-- "letter min effective day" automatically picks up offsets stored on
-- letters (from migration 0034).

alter table public.report_segments
  add column if not exists delivery_day_offset smallint;

-- Convert existing absolute pins to offsets where the offset is >= 1
-- (sub-default pins stay absolute — they're the only path to "report runs
-- before the day after the triggering letter", which the relative menu
-- intentionally forbids).
with report_default as (
  select
    rg.id as report_group_id,
    coalesce(
      (
        select min(d_eff.number)
        from public.inspection_letters_view ilv
        join public.days d_eff on d_eff.id = ilv.effective_day_id
        where ilv.letter_group_id = rg.letter_group_id
      ),
      (
        select d_lg.number
        from public.letter_groups lg2
        join public.days d_lg on d_lg.id = lg2.delivery_day_id
        where lg2.id = rg.letter_group_id
      )
    ) + 1 as default_number
  from public.report_groups rg
),
report_overrides as (
  select
    rs.id as segment_id,
    (d_override.number - rd.default_number) as offset
  from public.report_segments rs
  join report_default rd on rd.report_group_id = rs.report_group_id
  join public.days d_override on d_override.id = rs.delivery_day_override_id
  where rs.delivery_day_override_id is not null
    and rd.default_number is not null
    and (d_override.number - rd.default_number) >= 1
)
update public.report_segments rs
set    delivery_day_offset = ro.offset,
       delivery_day_override_id = null
from   report_overrides ro
where  rs.id = ro.segment_id;

-- Rows whose converted offset would be 0 (= default day, no override needed)
-- get both columns nulled. The conversion above already filtered to >=1, so
-- this catches no rows in practice but keeps the canonical form clean.
update public.report_segments
set    delivery_day_offset = null
where  delivery_day_offset = 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'report_segments_delivery_exclusive'
      and conrelid = 'public.report_segments'::regclass
  ) then
    alter table public.report_segments
      add constraint report_segments_delivery_exclusive
      check (delivery_day_override_id is null or delivery_day_offset is null);
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'report_segments_delivery_offset_min'
      and conrelid = 'public.report_segments'::regclass
  ) then
    alter table public.report_segments
      add constraint report_segments_delivery_offset_min
      check (delivery_day_offset is null or delivery_day_offset >= 1);
  end if;
end$$;

do $$
declare
  invalid_count  int;
  absolute_pins  int;
  offsets_set    int;
begin
  select count(*) into invalid_count
    from public.report_segments
   where delivery_day_override_id is not null
     and delivery_day_offset is not null;
  select count(*) into absolute_pins
    from public.report_segments
   where delivery_day_override_id is not null;
  select count(*) into offsets_set
    from public.report_segments
   where delivery_day_offset is not null;

  raise notice '0035 report_segments: invalid_both_set=% absolute_pins_remaining=% offsets_set=%',
    invalid_count, absolute_pins, offsets_set;

  if invalid_count <> 0 then
    raise exception 'report_segments has % rows with both override_id and offset set', invalid_count;
  end if;
end$$;

-- Recreate report_segments_view. effective_day_id resolves via:
--   1. absolute pin if set
--   2. otherwise: (min effective day across the report's TRIGGERING letters)
--      + 1 + offset.
-- Using the triggering letters specifically (not every letter in the group)
-- matches what the inspector panel computes, so inspector + graph + day
-- queries all agree once a trigger letter carries its own override.
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
            select min(d_il.number)
            from public.inspection_letters_view ilv
            join public.days d_il on d_il.id = ilv.effective_day_id
            where ilv.letter_group_id = rg.letter_group_id
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
