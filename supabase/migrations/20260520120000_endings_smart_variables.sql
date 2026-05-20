-- Smart Variables: extend the ending_document_kind enum with the new
-- 'smart_variable' value.
--
-- Postgres rejects (SQLSTATE 55P04) using a newly-added enum value in the
-- same transaction it was added in, so the value lives in its own
-- migration file. Every other constraint / index / FK that references the
-- new value lands in the immediately-following migration
-- (20260520120100_endings_smart_variables_constraints.sql) — supabase
-- applies each file as its own transaction, so by the time the next file
-- runs the enum change has already committed.
--
-- Idempotent (running this migration twice is a no-op): pg_enum guards
-- the `add value`, so a re-run on a populated DB is safe.
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'smart_variable'
      and enumtypid = 'ending_document_kind'::regtype
  ) then
    alter type ending_document_kind add value 'smart_variable';
  end if;
end $$;
