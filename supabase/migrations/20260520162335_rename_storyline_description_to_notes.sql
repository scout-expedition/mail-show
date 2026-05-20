-- Rename the `description` column on storylines to `notes` to be consistent
-- with the naming convention used on letter_groups, report_groups, and other
-- tables in the schema (all of which call this field `notes`).
--
-- No view selects from storylines by column (they join to it by id only),
-- so no view drop+recreate is required.
--
-- Guarded so `supabase db reset` / `db push` against a DB where the rename
-- has already been applied out-of-band (e.g. via the SQL editor) is a no-op
-- rather than a hard failure on "column description does not exist".

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'storylines'
      and column_name = 'description'
  ) then
    alter table public.storylines rename column description to notes;
  end if;
end$$;
