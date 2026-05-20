-- Split citizens.name into structured name parts + add address/display fields.
--
-- Citizens previously stored a single combined `name`. To support rules that
-- examine a sender's first vs last name independently — and to render proper
-- formatted postal addresses — names become discrete fields. Honorific, title,
-- suffix, name_display_format and address_line are added alongside.
--
-- Option lists for honorific / suffix / name_display_format are kept in TS
-- (src/lib/db/enums.ts), so these stay plain text columns (no Postgres enum).
--
-- The backfill + drop are guarded by `IF EXISTS column 'name'` so the file is
-- idempotent — re-running after `name` is dropped is a no-op.

alter table public.citizens
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '',
  add column if not exists middle_name text,
  add column if not exists honorific text,
  add column if not exists title text,
  add column if not exists suffix text,
  add column if not exists name_display_format text,
  add column if not exists address_line text;

-- Backfill first/last from the existing combined name, then drop `name`.
-- Last whitespace-delimited token -> last_name; the remainder -> first_name.
-- A single-token name goes entirely to first_name (last_name stays '').
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'citizens'
      and column_name = 'name'
  ) then
    update public.citizens set
      first_name = case
        when btrim(name) ~ '\s'
          then btrim(regexp_replace(btrim(name), '\s+\S+$', ''))
        else btrim(name)
      end,
      last_name = case
        when btrim(name) ~ '\s'
          then regexp_replace(btrim(name), '^.*\s+', '')
        else ''
      end;
    alter table public.citizens drop column name;
  end if;
end $$;

create index if not exists citizens_name_idx
  on public.citizens (last_name, first_name);
