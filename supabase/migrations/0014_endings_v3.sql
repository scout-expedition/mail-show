-- Endings blocks v3 — multi-variable conditions via chip rows.
--
-- The v2 model tied each condition block to a single variable and rendered
-- its values as side-by-side columns. v3 introduces:
--   * ending_condition_rows: ordered rows under a condition block. Each row
--     supplies a list of chips (AND across the chips); first matching row wins.
--   * ending_condition_row_chips: per-row predicates `[operator] [value]`
--     against any variable. Operators include the full numeric set so
--     Phase 2 (numeric impact-variable refs) doesn't need a schema bump.
--   * ending_variables.kind/number_ref/color_index: variables can be 'text'
--     (named values) or 'number_ref' (Phase 2; references numeric impact
--     columns from src/lib/playthrough/variables.ts). color_index is
--     deterministically hashed at insert time.
--   * ending_framework_blocks: parent_value_id replaced with parent_row_id.
--     variable_id removed — a condition block's variables are derived from
--     its rows' chips.
--
-- The kind/value cross-check (text variable can only have text_value_id, etc.)
-- is enforced at the application layer; CHECK constraints can't reference
-- another table. The intra-row check (exactly one of text_value_id /
-- number_value) is captured below.
--
-- Logic-tab tables (ending_logic_rules, ending_logic_rule_conditions) and
-- inspection_action_ending_assignments are unchanged — Phase 1 doesn't
-- migrate the Logic tab.
--
-- No data preservation: only test rows in dev.

-- 1) Wipe v2 tree data so the new constraints can apply cleanly.
delete from public.ending_framework_blocks;

-- 2) Variables: add kind, number_ref, color_index.
alter table public.ending_variables
  add column kind text not null default 'text'
    check (kind in ('text','number_ref')),
  add column number_ref text,
  add column color_index int not null default 0;

alter table public.ending_variables
  add constraint ending_variables_kind_shape
    check (
      (kind = 'text' and number_ref is null)
      or (kind = 'number_ref' and number_ref is not null)
    );

-- 3) Condition rows.
create table public.ending_condition_rows (
  id uuid primary key default uuid_generate_v4(),
  condition_block_id uuid not null references public.ending_framework_blocks(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ending_condition_rows_set_updated_at before update on public.ending_condition_rows
  for each row execute function public.set_updated_at();
create index ending_condition_rows_block_idx on public.ending_condition_rows(condition_block_id);

-- 4) Row chips.
create table public.ending_condition_row_chips (
  id uuid primary key default uuid_generate_v4(),
  row_id uuid not null references public.ending_condition_rows(id) on delete cascade,
  variable_id uuid not null references public.ending_variables(id) on delete restrict,
  operator text not null check (operator in ('=','≠','<','≤','>','≥')),
  text_value_id uuid references public.ending_variable_values(id) on delete cascade,
  number_value numeric,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ending_condition_row_chips_value_shape check (
    (text_value_id is not null and number_value is null)
    or (text_value_id is null and number_value is not null)
  )
);
create trigger ending_condition_row_chips_set_updated_at before update on public.ending_condition_row_chips
  for each row execute function public.set_updated_at();
create index ending_condition_row_chips_row_idx on public.ending_condition_row_chips(row_id);
create index ending_condition_row_chips_variable_idx on public.ending_condition_row_chips(variable_id);

-- 5) Re-shape ending_framework_blocks: parent_value_id → parent_row_id;
--    drop variable_id (vars derived from chips).
alter table public.ending_framework_blocks
  drop constraint if exists ending_framework_blocks_parent_shape;
alter table public.ending_framework_blocks
  drop constraint if exists ending_framework_blocks_type_shape;

drop index if exists public.ending_framework_blocks_parent_value_idx;

alter table public.ending_framework_blocks
  drop column parent_value_id,
  drop column variable_id,
  add column parent_row_id uuid references public.ending_condition_rows(id) on delete cascade;

alter table public.ending_framework_blocks
  add constraint ending_framework_blocks_parent_shape
    check (
      (parent_block_id is null and parent_row_id is null)
      or (parent_block_id is not null and parent_row_id is not null)
    );

create index ending_framework_blocks_parent_row_idx on public.ending_framework_blocks(parent_row_id);

-- 6) RLS: authenticated users full CRUD on the new tables.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'ending_condition_rows','ending_condition_row_chips'
  ]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (auth.role() = ''authenticated'')',
      t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (auth.role() = ''authenticated'')',
      t || '_insert', t);
    execute format('create policy %I on public.%I for update using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')',
      t || '_update', t);
    execute format('create policy %I on public.%I for delete using (auth.role() = ''authenticated'')',
      t || '_delete', t);
  end loop;
end $$;
