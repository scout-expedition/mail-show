-- Action templates: introduce groups, drop legacy pairing, drop hardcoded
-- display columns on actions, and enforce one-action-type-per-letter.
--
-- Background:
--   * `paired_template_id` (0005) modeled pairs via a self-FK with symmetric
--     pointers maintained in app code. Replaced here with `action_template_groups`
--     (any N members per group).
--   * `actions.{name,icon_type,icon_value,color_hex}` were a denormalized
--     snapshot of the template at insert time and would drift when the
--     template was edited. Display is now always derived from
--     `action_template_id`; an action with `action_template_id IS NULL` is
--     rendered as "Unset" by the UI.
--   * The unique partial index enforces the new product rule that a letter
--     can have at most one action of each type. NULL templates (unset rows)
--     are allowed in any quantity, matching the partial-index semantics.

-- 1. Groups table.
create table if not exists public.action_template_groups (
  id uuid primary key default uuid_generate_v4(),
  name text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.action_template_groups enable row level security;
drop policy if exists "action_template_groups_read" on public.action_template_groups;
create policy "action_template_groups_read"
  on public.action_template_groups for select using (true);
drop policy if exists "action_template_groups_write" on public.action_template_groups;
create policy "action_template_groups_write"
  on public.action_template_groups for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create or replace trigger action_template_groups_set_updated_at
  before update on public.action_template_groups
  for each row execute function public.set_updated_at();

-- 2. `group_id` on action_templates.
alter table public.action_templates
  add column if not exists group_id uuid
    references public.action_template_groups(id) on delete set null;
create index if not exists action_templates_group_idx
  on public.action_templates(group_id);

-- 3. Backfill: each existing pair becomes a group of 2.
do $$
declare
  pair record;
  gid uuid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'action_templates'
      and column_name = 'paired_template_id'
  ) then
    for pair in
      select distinct
        least(a.id, a.paired_template_id) as low,
        greatest(a.id, a.paired_template_id) as high
      from public.action_templates a
      where a.paired_template_id is not null
    loop
      insert into public.action_template_groups (name, sort_order)
        values (null, 0)
        returning id into gid;
      update public.action_templates
        set group_id = gid
        where id in (pair.low, pair.high);
    end loop;
  end if;
end $$;

-- 4. Drop legacy pairing column.
alter table public.action_templates
  drop column if exists paired_template_id;

-- 5. Enforce one action type per letter (NULL templates exempt).
create unique index if not exists actions_letter_template_unique
  on public.actions (inspection_letter_id, action_template_id)
  where action_template_id is not null;

-- 6. Drop the hardcoded display columns on actions. Display is sourced from
--    action_templates exclusively from this migration forward.
alter table public.actions
  drop column if exists name,
  drop column if exists icon_type,
  drop column if exists icon_value,
  drop column if exists color_hex;

-- 7. Add action_templates + action_template_groups to the realtime publication
--    so the admin page's presence + autosave wiring fans out across clients.
--    Idempotent (pg_publication_tables guard).
do $$
declare t text;
begin
  for t in select unnest(array[
    'action_templates',
    'action_template_groups'
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
