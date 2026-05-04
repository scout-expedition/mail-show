-- Endings frameworks Phase 6: header-declared variables on condition blocks.
--
-- Today the variable set a condition block branches on is *derived from
-- the chips* on its rows — a row that doesn't chip a variable is treated
-- as wildcard. That conflicts with the figma authoring intent (header
-- explicitly declares the variables; rows fill chip slots per declared
-- variable) and produces surprising counts in the Phase 5 uncovered
-- analysis.
--
-- This migration adds an explicit ending_condition_block_variables table
-- and backfills it from existing chip data: for each condition block,
-- the declared set is the union of variable_ids referenced by any chip
-- on any of its rows, in chip sort_order. The runtime evaluator stays
-- unchanged (rows still match by AND of present chips); the data is
-- consumed by the editor UI + the static analyzer.
--
-- Idempotent-friendly per project convention.

-- 1) Header table.
create table if not exists public.ending_condition_block_variables (
  id uuid primary key default uuid_generate_v4(),
  condition_block_id uuid not null
    references public.ending_framework_blocks(id) on delete cascade,
  variable_id uuid not null
    references public.ending_variables(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condition_block_id, variable_id)
);

create index if not exists ending_condition_block_variables_block_idx
  on public.ending_condition_block_variables(condition_block_id);

drop trigger if exists ending_condition_block_variables_set_updated_at
  on public.ending_condition_block_variables;
create trigger ending_condition_block_variables_set_updated_at
  before update on public.ending_condition_block_variables
  for each row execute function public.set_updated_at();

-- 2) RLS — same authenticated-user CRUD pattern as the v3 tables.
alter table public.ending_condition_block_variables enable row level security;

drop policy if exists ending_condition_block_variables_select
  on public.ending_condition_block_variables;
create policy ending_condition_block_variables_select
  on public.ending_condition_block_variables for select
  using (auth.role() = 'authenticated');

drop policy if exists ending_condition_block_variables_insert
  on public.ending_condition_block_variables;
create policy ending_condition_block_variables_insert
  on public.ending_condition_block_variables for insert
  with check (auth.role() = 'authenticated');

drop policy if exists ending_condition_block_variables_update
  on public.ending_condition_block_variables;
create policy ending_condition_block_variables_update
  on public.ending_condition_block_variables for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists ending_condition_block_variables_delete
  on public.ending_condition_block_variables;
create policy ending_condition_block_variables_delete
  on public.ending_condition_block_variables for delete
  using (auth.role() = 'authenticated');

-- 3) Backfill: for each condition block, insert one row per distinct
--    variable_id referenced by any chip on any of its rows. The
--    sort_order is the minimum chip sort_order for that variable so
--    repeat runs are deterministic. on conflict do nothing keeps
--    re-applies safe.
insert into public.ending_condition_block_variables
  (condition_block_id, variable_id, sort_order)
select
  rows.condition_block_id,
  chips.variable_id,
  min(chips.sort_order) as sort_order
from public.ending_condition_row_chips chips
join public.ending_condition_rows rows on rows.id = chips.row_id
group by rows.condition_block_id, chips.variable_id
on conflict (condition_block_id, variable_id) do nothing;
