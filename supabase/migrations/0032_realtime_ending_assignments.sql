-- Add inspection_action_ending_assignments to the supabase_realtime
-- publication so peer changes to an action's ending-variable mappings fan
-- out via postgres_changes. Without this, the workspace's
-- patchActionEndingAssignments writes succeed but other clients only see
-- the change on a page refresh — symptom is "ending variables don't update
-- live without refresh."
--
-- Idempotent (pg_publication_tables guard) and re-runnable. replica
-- identity full so DELETE payloads carry the prior row, which we need to
-- attribute removals to a specific action when re-deriving the workspace
-- mirror.

do $$
declare t text;
begin
  for t in select unnest(array[
    'inspection_action_ending_assignments'
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
