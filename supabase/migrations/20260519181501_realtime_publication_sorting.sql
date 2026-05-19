-- Add sorting tables to the supabase_realtime publication so browser clients
-- receive postgres_changes for live collaborative editing on the sorting
-- surfaces, and set replica identity full so UPDATE/DELETE payloads include
-- the prior row (needed for column-level diff + delete-toast attribution).
--
-- Tables:
--   sorting_letters       — per-day sorting letters (content_id, recipient/sender)
--   sorting_rules         — A-Z rules with slot / day / storage / summary
--   sorting_rule_conditions — up to 3 conditions per rule (position-ordered)
--
-- Idempotent (pg_publication_tables guard) and re-runnable. REPLICA IDENTITY
-- FULL is itself idempotent.

do $$
declare t text;
begin
  for t in select unnest(array[
    'sorting_letters',
    'sorting_rules',
    'sorting_rule_conditions'
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
