-- Endings logic v2 — unify frameworks and the Logic tab onto one
-- chip-row primitive.
--
-- Frameworks and the five logic kinds (framework selection + four
-- affinity tiebreakers) are all "documents" in the new shape. The
-- block tree gains a 'result' leaf type alongside text. Logic docs
-- end in result blocks carrying one of the doc's allowed result
-- values (a class/nation column name, or a framework document_id).
--
-- This drops the existing framework block tree, the old flat logic
-- tables, and ending_frameworks. None of that data is real (only test
-- rows in dev), per project convention for endings rebuilds (0010,
-- 0014).
--
-- Idempotent-friendly: re-applies are safe and do not wipe data once
-- the new schema is in place. The destructive drops at the top only
-- fire when the OLD ending_frameworks table is still present.

-- 1) Drop old shape — only on first apply, signalled by the presence
-- of the old ending_frameworks table. After that, this is a no-op.
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='ending_frameworks') then
    drop table if exists public.ending_logic_rule_conditions cascade;
    drop table if exists public.ending_logic_rules cascade;
    drop table if exists public.ending_condition_block_variables cascade;
    drop table if exists public.ending_condition_row_chips cascade;
    drop table if exists public.ending_condition_rows cascade;
    drop table if exists public.ending_framework_blocks cascade;
    drop table if exists public.ending_frameworks cascade;
  end if;
end $$;

-- 2) Document kind enum.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'ending_document_kind') then
    create type ending_document_kind as enum (
      'framework',
      'framework_selection',
      'class_affinity_top',
      'class_affinity_bottom',
      'nation_affinity_top',
      'nation_affinity_bottom'
    );
  end if;
end $$;

-- 3) Documents. Frameworks carry a user-facing name + sort_order; logic
-- docs are anonymous singletons (one per non-'framework' kind).
create table if not exists public.ending_documents (
  id uuid primary key default uuid_generate_v4(),
  kind ending_document_kind not null,
  name text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ending_documents_name_shape check (
    (kind = 'framework' and name is not null)
    or (kind <> 'framework' and name is null)
  )
);

create or replace trigger ending_documents_set_updated_at before update on public.ending_documents
  for each row execute function public.set_updated_at();

-- Singleton enforcement for non-framework kinds.
create unique index if not exists ending_documents_singleton_kinds
  on public.ending_documents (kind)
  where kind <> 'framework';

-- Framework names stay unique among frameworks.
create unique index if not exists ending_documents_framework_name_unique
  on public.ending_documents (name)
  where kind = 'framework';

-- Seed singleton logic docs. Deterministic uuid_v5 on the same namespace
-- as 0016/0020 so future migrations + tests can reference them.
do $$
declare
  ns uuid := '0e3f1c00-0000-0000-0000-000000000000';
  k  ending_document_kind;
begin
  for k in
    select unnest(array[
      'framework_selection'::ending_document_kind,
      'class_affinity_top'::ending_document_kind,
      'class_affinity_bottom'::ending_document_kind,
      'nation_affinity_top'::ending_document_kind,
      'nation_affinity_bottom'::ending_document_kind
    ])
  loop
    if not exists (select 1 from public.ending_documents d where d.kind = k) then
      insert into public.ending_documents (id, kind)
      values (uuid_generate_v5(ns, k::text), k);
    end if;
  end loop;
end $$;

-- 4) Blocks (replaces ending_framework_blocks). block_type widens to
-- include 'result' leaves carrying a result_value. text + result_value
-- are mutually exclusive; condition blocks have neither.
create table if not exists public.ending_blocks (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.ending_documents(id) on delete cascade,
  parent_block_id uuid references public.ending_blocks(id) on delete cascade,
  parent_row_id uuid,  -- FK added after ending_condition_rows below
  sort_order int not null default 0,
  block_type text not null check (block_type in ('text','condition','result')),
  text text,
  result_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ending_blocks_type_payload check (
    (block_type = 'text'      and text is not null         and result_value is null)
    or (block_type = 'result' and result_value is not null and text is null)
    or (block_type = 'condition' and text is null          and result_value is null)
  ),
  constraint ending_blocks_parent_shape check (
    (parent_block_id is null and parent_row_id is null)
    or (parent_block_id is not null and parent_row_id is not null)
  )
);

create or replace trigger ending_blocks_set_updated_at before update on public.ending_blocks
  for each row execute function public.set_updated_at();

create index if not exists ending_blocks_document_idx on public.ending_blocks(document_id);
create index if not exists ending_blocks_parent_idx on public.ending_blocks(parent_block_id);

-- 5) Rows + chips + header variables. Names retain "condition_" because
-- they only ever attach to condition-kind blocks; the table shapes
-- mirror their pre-rebuild counterparts (0014/0020/0021).
create table if not exists public.ending_condition_rows (
  id uuid primary key default uuid_generate_v4(),
  condition_block_id uuid not null references public.ending_blocks(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace trigger ending_condition_rows_set_updated_at before update on public.ending_condition_rows
  for each row execute function public.set_updated_at();
create index if not exists ending_condition_rows_block_idx on public.ending_condition_rows(condition_block_id);

-- Now wire ending_blocks.parent_row_id to ending_condition_rows.
do $$ begin
  alter table public.ending_blocks
    add constraint ending_blocks_parent_row_fk
    foreign key (parent_row_id)
    references public.ending_condition_rows(id) on delete cascade;
exception when duplicate_object then null; end $$;
create index if not exists ending_blocks_parent_row_idx on public.ending_blocks(parent_row_id);

create table if not exists public.ending_condition_row_chips (
  id uuid primary key default uuid_generate_v4(),
  row_id uuid not null references public.ending_condition_rows(id) on delete cascade,
  variable_id uuid not null references public.ending_variables(id) on delete cascade,
  operator text not null check (operator in (
    '=','≠','<','≤','>','≥',
    'top=','top≠','bottom=','bottom≠'
  )),
  text_value_id uuid references public.ending_variable_values(id) on delete cascade,
  number_value numeric,
  aggregate_value text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ending_condition_row_chips_value_shape check (
    (text_value_id   is not null and number_value is null     and aggregate_value is null)
    or (number_value    is not null and text_value_id is null    and aggregate_value is null)
    or (aggregate_value is not null and text_value_id is null    and number_value    is null)
  )
);
create or replace trigger ending_condition_row_chips_set_updated_at before update on public.ending_condition_row_chips
  for each row execute function public.set_updated_at();
create index if not exists ending_condition_row_chips_row_idx on public.ending_condition_row_chips(row_id);
create index if not exists ending_condition_row_chips_variable_idx on public.ending_condition_row_chips(variable_id);

create table if not exists public.ending_condition_block_variables (
  id uuid primary key default uuid_generate_v4(),
  condition_block_id uuid not null references public.ending_blocks(id) on delete cascade,
  variable_id uuid not null references public.ending_variables(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condition_block_id, variable_id)
);
create or replace trigger ending_condition_block_variables_set_updated_at before update on public.ending_condition_block_variables
  for each row execute function public.set_updated_at();
create index if not exists ending_condition_block_variables_block_idx on public.ending_condition_block_variables(condition_block_id);

-- 6) RLS — same authenticated-user CRUD as v3.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'ending_documents','ending_blocks','ending_condition_rows',
    'ending_condition_row_chips','ending_condition_block_variables'
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
