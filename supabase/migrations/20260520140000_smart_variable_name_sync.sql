-- Smart Variables: keep ending_documents.name and the paired
-- ending_variables.name in lockstep, and backfill any rows that
-- diverged before this guard existed.
--
-- The paired ending_variables row (kind='smart_ref') is the public
-- identity of a smart variable — every chip picker across endings +
-- frameworks reads `ending_variables.name`. The original migration
-- created the pair but left the two names independent, so renaming a
-- doc through the editor left the variable row stale and the next
-- `createSmartVariable` collided on `ending_variables_name_key`.
--
-- This migration installs a trigger that mirrors every rename of a
-- smart_variable doc onto its paired variable row, then runs a one-shot
-- backfill so existing diverged pairs converge.

-- 1) Trigger function: when a smart_variable doc is renamed, propagate
-- the new name to the paired ending_variables row. Only fires when the
-- name actually changed (cheap NEW.name = OLD.name short-circuit) so a
-- summary/sort_order update doesn't churn the variable row.
create or replace function public.sync_smart_variable_name()
returns trigger
language plpgsql
as $$
begin
  if new.kind <> 'smart_variable' then
    return new;
  end if;
  if new.name is distinct from old.name then
    update public.ending_variables
       set name = new.name
     where smart_variable_doc_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_smart_variable_name
  on public.ending_documents;
create trigger trg_sync_smart_variable_name
  after update of name on public.ending_documents
  for each row
  when (new.kind = 'smart_variable')
  execute function public.sync_smart_variable_name();

-- 2) Backfill: align any existing diverged pairs. Idempotent — re-runs
-- are no-ops because the WHERE clause skips already-matching rows.
update public.ending_variables v
   set name = d.name
  from public.ending_documents d
 where v.smart_variable_doc_id = d.id
   and d.kind = 'smart_variable'
   and v.name is distinct from d.name;
