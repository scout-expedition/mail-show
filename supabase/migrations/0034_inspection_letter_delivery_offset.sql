-- Relative delivery dates, Phase 1: inspection letters
--
-- Adds a signed `delivery_day_offset` column to inspection_letters so per-letter
-- overrides can be expressed as a delta relative to their letter group's
-- `delivery_day_id` instead of as an absolute pin. Existing absolute pins are
-- auto-converted to offsets where they can be expressed; rows whose group has
-- no `delivery_day_id` stay as absolute pins. The CHECK constraint ensures the
-- two columns are mutually exclusive going forward.

alter table public.inspection_letters
  add column if not exists delivery_day_offset smallint;

-- Convert existing absolute overrides to offsets where the group has a
-- delivery_day_id. After this, rows whose offset would be 0 (override matched
-- the group day exactly) get both columns nulled so "no override" is the
-- canonical representation.
with letter_overrides as (
  select
    il.id as letter_id,
    (d_override.number - d_group.number) as offset
  from public.inspection_letters il
  join public.letter_groups lg on lg.id = il.letter_group_id
  join public.days d_group on d_group.id = lg.delivery_day_id
  join public.days d_override on d_override.id = il.delivery_day_override_id
  where il.delivery_day_override_id is not null
    and lg.delivery_day_id is not null
)
update public.inspection_letters il
set    delivery_day_offset = lo.offset,
       delivery_day_override_id = null
from   letter_overrides lo
where  il.id = lo.letter_id;

update public.inspection_letters
set    delivery_day_offset = null
where  delivery_day_offset = 0;

-- Add the exclusivity constraint after conversion so the auto-update isn't
-- blocked by transient both-set states. The `not valid` + `validate` dance
-- keeps the constraint cheap on re-runs.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inspection_letters_delivery_exclusive'
      and conrelid = 'public.inspection_letters'::regclass
  ) then
    alter table public.inspection_letters
      add constraint inspection_letters_delivery_exclusive
      check (delivery_day_override_id is null or delivery_day_offset is null);
  end if;
end$$;

-- Sanity counts: log how many rows ended up where.
do $$
declare
  invalid_count  int;
  absolute_pins  int;
  offsets_set    int;
begin
  select count(*) into invalid_count
    from public.inspection_letters
   where delivery_day_override_id is not null
     and delivery_day_offset is not null;
  select count(*) into absolute_pins
    from public.inspection_letters
   where delivery_day_override_id is not null;
  select count(*) into offsets_set
    from public.inspection_letters
   where delivery_day_offset is not null;

  raise notice '0034 inspection_letters: invalid_both_set=% absolute_pins_remaining=% offsets_set=%',
    invalid_count, absolute_pins, offsets_set;

  if invalid_count <> 0 then
    raise exception 'inspection_letters has % rows with both override_id and offset set', invalid_count;
  end if;
end$$;

-- Recreate inspection_letters_view with offset-aware effective_day_id.
-- Preserves the gc CTE from migration 0011 (single-letter variant handling).
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
