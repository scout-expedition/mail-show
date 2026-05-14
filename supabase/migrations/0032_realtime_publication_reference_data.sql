-- Wire reference-data tables into the supabase_realtime publication so
-- browser clients receive postgres_changes for live collaborative editing,
-- and set replica identity full so UPDATE/DELETE payloads include the
-- prior row (needed for column-level diff + delete-toast attribution).
--
-- Idempotent: pg_publication_tables guards the ADD TABLE so re-runs are
-- safe. REPLICA IDENTITY FULL is itself idempotent.
--
-- Note: replica identity full bloats WAL relative to the default
-- (primary-key only). Acceptable at current team size; revisit if Supabase
-- usage spikes.

do $$
declare t text;
begin
  for t in select unnest(array[
    'cities',
    'citizens',
    'nations'
  ]) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
