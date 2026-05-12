-- Endings block model v2.
--
-- Blocks are now typed:
--   * 'text'      — literal text
--   * 'condition' — branches on a single variable; its children each belong
--                    to one of that variable's values (parent_value_id).
-- Children of a condition block carry parent_value_id identifying which
-- value-column they render in. This replaces the separate block-conditions
-- table (which modelled conditions as AND-ed rows attached to text blocks).
--
-- No data preservation: ending_frameworks / ending_framework_blocks /
-- ending_block_conditions contained only a handful of test rows.

do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='ending_block_conditions') then
    delete from public.ending_framework_blocks;
    delete from public.ending_frameworks;
  end if;
end $$;

drop table if exists public.ending_block_conditions;

alter table public.ending_framework_blocks
  add column if not exists block_type text not null default 'text'
    check (block_type in ('text','condition')),
  add column if not exists variable_id uuid references public.ending_variables(id) on delete restrict,
  add column if not exists parent_value_id uuid references public.ending_variable_values(id) on delete cascade;

do $$ begin
  alter table public.ending_framework_blocks
    add constraint ending_framework_blocks_type_shape
      check (
        (block_type = 'text' and variable_id is null)
        or (block_type = 'condition' and variable_id is not null)
      );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ending_framework_blocks
    add constraint ending_framework_blocks_parent_shape
      check (
        (parent_block_id is null and parent_value_id is null)
        or (parent_block_id is not null and parent_value_id is not null)
      );
exception when duplicate_object then null; end $$;

create index if not exists ending_framework_blocks_parent_value_idx
  on public.ending_framework_blocks(parent_value_id);
