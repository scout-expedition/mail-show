-- Make `ending_variable_folders.scope` immutable post-insert. The existing
-- triggers from 20260520200250 only validate the row being updated — they
-- don't cascade to descendants or contained variables. An UPDATE that
-- changes scope on a populated folder would silently orphan every nested
-- folder and variable under the wrong scope. Reject scope mutation
-- outright so the partition stays trustworthy.

create or replace function public.evf_check_scope_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.scope is distinct from old.scope then
    raise exception
      'ending_variable_folders.scope is immutable (was %, attempted %)',
      old.scope, new.scope;
  end if;
  return new;
end;
$$;

drop trigger if exists evf_scope_immutable on public.ending_variable_folders;
create trigger evf_scope_immutable
  before update of scope on public.ending_variable_folders
  for each row execute function public.evf_check_scope_immutable();
