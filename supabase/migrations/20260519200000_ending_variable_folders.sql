-- Nestable folders for organizing ending variables. Folders are an
-- organizational layer that the "All" view honors and the "By Ending"
-- view ignores (the latter groups by referencing framework / logic doc
-- regardless of folder membership).
--
-- Schema is intentionally lean:
--   - ending_variable_folders.parent_folder_id self-FK (nestable).
--   - ON DELETE RESTRICT — non-destructive reparent is enforced in the
--     server action; restricting at the DB ensures that an out-of-band
--     delete cannot silently drop child folders.
--   - CHECK rejects the trivial self-loop; trigger walks the ancestor
--     chain to reject transitive cycles. The closest precedent
--     (ending_blocks.parent_block_id) lacks both — do not copy that gap.
--   - ending_variables.folder_id is ON DELETE SET NULL (variables fall
--     back to root when their folder is force-deleted at the DB layer).

create table if not exists public.ending_variable_folders (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  parent_folder_id uuid references public.ending_variable_folders(id) on delete restrict,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evf_no_self_parent check (parent_folder_id is null or parent_folder_id <> id)
);
create index if not exists ending_variable_folders_parent_idx
  on public.ending_variable_folders(parent_folder_id);

create or replace trigger ending_variable_folders_set_updated_at
  before update on public.ending_variable_folders
  for each row execute function public.set_updated_at();

-- Cycle prevention (deeper than the self-parent CHECK): walk the ancestor
-- chain on insert/update of parent_folder_id and reject if we encounter
-- the row's own id.
create or replace function public.evf_check_no_cycle() returns trigger as $$
declare ancestor uuid := new.parent_folder_id;
begin
  while ancestor is not null loop
    if ancestor = new.id then
      raise exception 'ending_variable_folders: cycle detected involving %', new.id;
    end if;
    select parent_folder_id into ancestor
      from public.ending_variable_folders where id = ancestor;
  end loop;
  return new;
end $$ language plpgsql;

drop trigger if exists evf_no_cycle on public.ending_variable_folders;
create trigger evf_no_cycle
  before insert or update of parent_folder_id on public.ending_variable_folders
  for each row execute function public.evf_check_no_cycle();

alter table public.ending_variables
  add column if not exists folder_id uuid
  references public.ending_variable_folders(id) on delete set null;
create index if not exists ending_variables_folder_idx
  on public.ending_variables(folder_id);

-- RLS: authenticated users full CRUD (mirrors the ending_variables policy
-- from 0009_endings.sql).
do $$ begin
  execute 'alter table public.ending_variable_folders enable row level security';
  execute 'drop policy if exists ending_variable_folders_select on public.ending_variable_folders';
  execute 'create policy ending_variable_folders_select on public.ending_variable_folders for select using (auth.role() = ''authenticated'')';
  execute 'drop policy if exists ending_variable_folders_insert on public.ending_variable_folders';
  execute 'create policy ending_variable_folders_insert on public.ending_variable_folders for insert with check (auth.role() = ''authenticated'')';
  execute 'drop policy if exists ending_variable_folders_update on public.ending_variable_folders';
  execute 'create policy ending_variable_folders_update on public.ending_variable_folders for update using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')';
  execute 'drop policy if exists ending_variable_folders_delete on public.ending_variable_folders';
  execute 'create policy ending_variable_folders_delete on public.ending_variable_folders for delete using (auth.role() = ''authenticated'')';
end $$;

-- Realtime: include the new table in the publication with replica
-- identity full (matches 20260519181504_realtime_publication_endings.sql).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ending_variable_folders'
  ) then
    execute 'alter publication supabase_realtime add table public.ending_variable_folders';
  end if;
  execute 'alter table public.ending_variable_folders replica identity full';
end $$;
