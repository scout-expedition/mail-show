-- Wire ending tables into the supabase_realtime publication so browser
-- clients receive postgres_changes for live collaborative editing on
-- the frameworks + logic + variables surfaces. Mirrors the realtime-
-- publication pattern from 0031 plus the sorting + reference-data ones.
--
-- Without this, useInstantField commits land on the server but peers
-- never see the UPDATE / INSERT / DELETE — the local editor self-echo
-- works, but cross-tab and cross-user collaboration is silent.
--
-- Idempotent: pg_publication_tables guards the ADD TABLE so re-runs are
-- safe. REPLICA IDENTITY FULL is itself idempotent.
--
-- Note: replica identity full bloats WAL relative to the default
-- (primary-key only). Acceptable at current team size; revisit if
-- Supabase usage spikes.

do $$
declare t text;
begin
  for t in select unnest(array[
    'ending_documents',
    'ending_blocks',
    'ending_condition_rows',
    'ending_condition_row_chips',
    'ending_condition_block_variables',
    'ending_variables',
    'ending_variable_values'
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
