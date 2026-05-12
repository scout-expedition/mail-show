-- Endings — madlib-style game endings.
--
-- Three top-level concepts:
--   1. ending_variables + ending_variable_values — the named slots and the
--      discrete set of values each can take. Each variable has an optional
--      default value used by the preview panel.
--   2. ending_frameworks + ending_framework_blocks + ending_block_conditions
--      — per-framework trees of text blocks, each gated by zero-or-more
--      (variable = value) AND-ed conditions. Nested blocks inherit their
--      parent's conditions implicitly.
--   3. ending_logic_rules + ending_logic_rule_conditions — ordered rules
--      that select which framework plays, first-match-wins on AND-ed
--      (variable = value) conditions.
--
-- Plus: inspection_action_ending_assignments links inspection-letter
-- actions to (variable, value) pairs they set when the player picks that
-- action.

create table if not exists public.ending_variables (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  default_value_id uuid, -- FK added once ending_variable_values exists
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace trigger ending_variables_set_updated_at before update on public.ending_variables
  for each row execute function public.set_updated_at();

create table if not exists public.ending_variable_values (
  id uuid primary key default uuid_generate_v4(),
  variable_id uuid not null references public.ending_variables(id) on delete cascade,
  value text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (variable_id, value)
);
create or replace trigger ending_variable_values_set_updated_at before update on public.ending_variable_values
  for each row execute function public.set_updated_at();
create index if not exists ending_variable_values_variable_idx on public.ending_variable_values(variable_id);

do $$ begin
  alter table public.ending_variables
    add constraint ending_variables_default_value_fk
    foreign key (default_value_id) references public.ending_variable_values(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.ending_frameworks (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace trigger ending_frameworks_set_updated_at before update on public.ending_frameworks
  for each row execute function public.set_updated_at();

create table if not exists public.ending_framework_blocks (
  id uuid primary key default uuid_generate_v4(),
  framework_id uuid not null references public.ending_frameworks(id) on delete cascade,
  parent_block_id uuid references public.ending_framework_blocks(id) on delete cascade,
  text text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace trigger ending_framework_blocks_set_updated_at before update on public.ending_framework_blocks
  for each row execute function public.set_updated_at();
create index if not exists ending_framework_blocks_framework_idx on public.ending_framework_blocks(framework_id);
create index if not exists ending_framework_blocks_parent_idx on public.ending_framework_blocks(parent_block_id);

-- At most one condition per (block, variable) since AND-ing two values for
-- the same variable can never match.
create table if not exists public.ending_block_conditions (
  id uuid primary key default uuid_generate_v4(),
  block_id uuid not null references public.ending_framework_blocks(id) on delete cascade,
  variable_id uuid not null references public.ending_variables(id) on delete cascade,
  value_id uuid not null references public.ending_variable_values(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (block_id, variable_id)
);
create or replace trigger ending_block_conditions_set_updated_at before update on public.ending_block_conditions
  for each row execute function public.set_updated_at();
create index if not exists ending_block_conditions_block_idx on public.ending_block_conditions(block_id);

create table if not exists public.ending_logic_rules (
  id uuid primary key default uuid_generate_v4(),
  framework_id uuid not null references public.ending_frameworks(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace trigger ending_logic_rules_set_updated_at before update on public.ending_logic_rules
  for each row execute function public.set_updated_at();
create index if not exists ending_logic_rules_framework_idx on public.ending_logic_rules(framework_id);

create table if not exists public.ending_logic_rule_conditions (
  id uuid primary key default uuid_generate_v4(),
  rule_id uuid not null references public.ending_logic_rules(id) on delete cascade,
  variable_id uuid not null references public.ending_variables(id) on delete cascade,
  value_id uuid not null references public.ending_variable_values(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, variable_id)
);
create or replace trigger ending_logic_rule_conditions_set_updated_at before update on public.ending_logic_rule_conditions
  for each row execute function public.set_updated_at();
create index if not exists ending_logic_rule_conditions_rule_idx on public.ending_logic_rule_conditions(rule_id);

create table if not exists public.inspection_action_ending_assignments (
  id uuid primary key default uuid_generate_v4(),
  action_id uuid not null references public.actions(id) on delete cascade,
  variable_id uuid not null references public.ending_variables(id) on delete cascade,
  value_id uuid not null references public.ending_variable_values(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action_id, variable_id)
);
create or replace trigger inspection_action_ending_assignments_set_updated_at before update on public.inspection_action_ending_assignments
  for each row execute function public.set_updated_at();
create index if not exists inspection_action_ending_assignments_action_idx on public.inspection_action_ending_assignments(action_id);

-- RLS: authenticated users full CRUD.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'ending_variables','ending_variable_values','ending_frameworks',
    'ending_framework_blocks','ending_block_conditions',
    'ending_logic_rules','ending_logic_rule_conditions',
    'inspection_action_ending_assignments'
  ]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (auth.role() = ''authenticated'')',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (auth.role() = ''authenticated'')',
      t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')',
      t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete using (auth.role() = ''authenticated'')',
      t || '_delete', t);
  end loop;
end $$;
