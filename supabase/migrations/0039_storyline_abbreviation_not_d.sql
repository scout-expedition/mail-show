-- 0039_storyline_abbreviation_not_d.sql
--
-- Reserves abbreviation 'D' (case-insensitive) for the day-identifier
-- namespace. Morning Reports (0038) generates generic-block display IDs in
-- the format R-D{n}/{variant} — e.g. R-D1/intro, R-D3/weather — where 'D'
-- is a fixed prefix for the day number. Allowing a storyline abbreviation of
-- 'D' would create ambiguous IDs that collide with that scheme.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT.

alter table public.storylines drop constraint if exists storylines_abbreviation_not_d;
alter table public.storylines add constraint storylines_abbreviation_not_d
  check (upper(abbreviation) <> 'D');
