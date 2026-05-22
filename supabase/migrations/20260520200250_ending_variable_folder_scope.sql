-- Partition `ending_variable_folders` into two independent namespaces:
--   - scope='variable'        -> visible/owned by /endings/variables
--   - scope='smart_variable'  -> visible/owned by /endings/smart-variables
--
-- Pages filter by scope server-side; triggers below also reject cross-scope
-- parenting and cross-scope variable->folder assignment so the DB stays
-- truthful even if a buggy caller skips the filter.
--
-- Backfill: every existing folder defaults to scope='variable' (correct —
-- smart vars had no folder UI before this migration, so no rows referenced
-- a "smart" folder).

alter table public.ending_variable_folders
  add column if not exists scope text not null default 'variable'
  check (scope in ('variable', 'smart_variable'));

create index if not exists ending_variable_folders_scope_idx
  on public.ending_variable_folders(scope);

-- Reject parenting across scopes. A 'variable' folder cannot live inside
-- a 'smart_variable' parent and vice versa.
create or replace function public.evf_check_scope_alignment()
returns trigger
language plpgsql
as $$
declare
  parent_scope text;
begin
  if new.parent_folder_id is null then
    return new;
  end if;
  select scope into parent_scope
    from public.ending_variable_folders
    where id = new.parent_folder_id;
  if parent_scope is null then
    raise exception
      'ending_variable_folders: parent % does not exist', new.parent_folder_id;
  end if;
  if parent_scope is distinct from new.scope then
    raise exception
      'ending_variable_folders: parent scope % does not match child scope %',
      parent_scope, new.scope;
  end if;
  return new;
end;
$$;

drop trigger if exists evf_scope_alignment on public.ending_variable_folders;
create trigger evf_scope_alignment
  before insert or update of parent_folder_id, scope
  on public.ending_variable_folders
  for each row execute function public.evf_check_scope_alignment();

-- Reject `ending_variables.folder_id` pointing at a wrong-scope folder.
-- A smart_ref variable must live in a 'smart_variable' folder (or root).
-- Everything else must live in a 'variable' folder (or root).
create or replace function public.ending_variables_check_folder_scope()
returns trigger
language plpgsql
as $$
declare
  f_scope text;
  expected text;
begin
  if new.folder_id is null then
    return new;
  end if;
  select scope into f_scope
    from public.ending_variable_folders
    where id = new.folder_id;
  if f_scope is null then
    raise exception
      'ending_variables: folder_id % does not exist', new.folder_id;
  end if;
  expected := case when new.kind = 'smart_ref' then 'smart_variable'
                   else 'variable' end;
  if f_scope is distinct from expected then
    raise exception
      'ending_variables: kind % requires folder scope %, got %',
      new.kind, expected, f_scope;
  end if;
  return new;
end;
$$;

drop trigger if exists ending_variables_folder_scope
  on public.ending_variables;
create trigger ending_variables_folder_scope
  before insert or update of folder_id, kind
  on public.ending_variables
  for each row execute function public.ending_variables_check_folder_scope();
