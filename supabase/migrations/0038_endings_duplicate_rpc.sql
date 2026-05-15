-- Transactional deep-clone of ending blocks / condition rows.
--
-- The JS duplicateBlock / duplicateRow server actions issued many
-- independent inserts + updates with no surrounding transaction: a
-- constraint error mid-clone left shifted sibling sort_orders and a
-- partial subtree behind, with no failed-clone root to cascade-delete
-- (GitHub issue #36).
--
-- Moving the clone into PL/pgSQL functions makes each duplicate a single
-- transaction — any failure rolls the whole thing back. The functions
-- are SECURITY INVOKER (default), so RLS still applies exactly as it did
-- for the cookie-aware server-client writes they replace.

-- 1) Make the two self-referential ending_blocks foreign keys deferrable
--    so the clone can be bulk-inserted in any order; the references are
--    re-checked when the function's transaction commits. `initially
--    immediate` keeps behaviour unchanged for every other caller — the
--    constraints are only deferred inside a transaction that asks.

alter table public.ending_blocks
  alter constraint ending_blocks_parent_row_fk deferrable initially immediate;

-- The parent_block_id self-FK is auto-named by Postgres; look it up
-- rather than hard-coding the conventional name.
do $$
declare
  v_self_fk text;
begin
  select c.conname into v_self_fk
  from pg_constraint c
  where c.conrelid = 'public.ending_blocks'::regclass
    and c.contype = 'f'
    and c.confrelid = 'public.ending_blocks'::regclass;
  if v_self_fk is null then
    raise exception 'ending_blocks self-referential FK not found';
  end if;
  execute format(
    'alter table public.ending_blocks alter constraint %I deferrable initially immediate',
    v_self_fk
  );
end $$;

-- 2) duplicate_ending_block — deep-clone a block + every row, chip,
--    header-variable and descendant block beneath it. The clone is
--    inserted immediately after the original; later siblings shift down.

create or replace function public.duplicate_ending_block(p_block_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_original public.ending_blocks%rowtype;
  v_insert_sort int;
begin
  select * into v_original from public.ending_blocks where id = p_block_id;
  if not found then
    raise exception 'Block % not found.', p_block_id;
  end if;
  if v_original.block_type = 'fallback' then
    raise exception 'Fallback blocks can''t be duplicated.';
  end if;
  if v_original.block_type = 'result' then
    raise exception 'Result blocks can''t be duplicated.';
  end if;

  -- Defer the (now deferrable) ending_blocks FKs for this transaction so
  -- blocks and rows can be bulk-inserted in any order.
  set constraints all deferred;

  -- Collect the block subtree (root + every descendant). A block is a
  -- descendant when its parent_row_id belongs to a row whose
  -- condition_block_id is an already-collected block. Recursing on
  -- blocks alone keeps the recursive term referencing the CTE once.
  create temp table _dup_block_map (
    old_id uuid primary key,
    new_id uuid not null default gen_random_uuid()
  ) on commit drop;
  insert into _dup_block_map (old_id)
  with recursive block_tree (id) as (
    select id from public.ending_blocks where id = p_block_id
    union all
    select b.id
    from public.ending_blocks b
    join public.ending_condition_rows r on r.id = b.parent_row_id
    join block_tree t on t.id = r.condition_block_id
  )
  select id from block_tree;

  -- Every row under a collected block.
  create temp table _dup_row_map (
    old_id uuid primary key,
    new_id uuid not null default gen_random_uuid()
  ) on commit drop;
  insert into _dup_row_map (old_id)
  select id from public.ending_condition_rows
  where condition_block_id in (select old_id from _dup_block_map);

  -- Open the insertion slot: shift later siblings down by one. No
  -- (parent, sort_order) unique index exists, so a plain shift is safe.
  v_insert_sort := v_original.sort_order + 1;
  update public.ending_blocks
  set sort_order = sort_order + 1
  where document_id = v_original.document_id
    and parent_block_id is not distinct from v_original.parent_block_id
    and parent_row_id is not distinct from v_original.parent_row_id
    and block_type <> 'fallback'
    and sort_order >= v_insert_sort
    and id <> p_block_id;

  -- Clone the blocks. The root keeps the original's parent and takes the
  -- new slot; descendants get their parent block + row remapped.
  insert into public.ending_blocks
    (id, document_id, parent_block_id, parent_row_id, sort_order,
     block_type, text, result_value, summary)
  select
    bm.new_id,
    b.document_id,
    case when b.id = p_block_id then b.parent_block_id else pbm.new_id end,
    case when b.id = p_block_id then b.parent_row_id else prm.new_id end,
    case when b.id = p_block_id then v_insert_sort else b.sort_order end,
    b.block_type, b.text, b.result_value, b.summary
  from public.ending_blocks b
  join _dup_block_map bm on bm.old_id = b.id
  left join _dup_block_map pbm on pbm.old_id = b.parent_block_id
  left join _dup_row_map prm on prm.old_id = b.parent_row_id;

  -- Clone the rows.
  insert into public.ending_condition_rows (id, condition_block_id, sort_order)
  select rm.new_id, bm.new_id, r.sort_order
  from public.ending_condition_rows r
  join _dup_row_map rm on rm.old_id = r.id
  join _dup_block_map bm on bm.old_id = r.condition_block_id;

  -- Clone the chips.
  insert into public.ending_condition_row_chips
    (row_id, variable_id, operator, text_value_id, number_value,
     aggregate_value, sort_order)
  select rm.new_id, c.variable_id, c.operator, c.text_value_id,
         c.number_value, c.aggregate_value, c.sort_order
  from public.ending_condition_row_chips c
  join _dup_row_map rm on rm.old_id = c.row_id;

  -- Clone the header variables.
  insert into public.ending_condition_block_variables
    (condition_block_id, variable_id, sort_order)
  select bm.new_id, v.variable_id, v.sort_order
  from public.ending_condition_block_variables v
  join _dup_block_map bm on bm.old_id = v.condition_block_id;

  return (select new_id from _dup_block_map where old_id = p_block_id);
end;
$$;

-- 3) duplicate_ending_row — deep-clone a row + its chips + every block
--    (and descendant) underneath it. The clone is inserted immediately
--    after the original row; later rows in the same block shift down.

create or replace function public.duplicate_ending_row(p_row_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_original public.ending_condition_rows%rowtype;
  v_new_row_id uuid := gen_random_uuid();
begin
  select * into v_original from public.ending_condition_rows where id = p_row_id;
  if not found then
    raise exception 'Row % not found.', p_row_id;
  end if;

  set constraints all deferred;

  -- Shift later rows in the same condition block down by one.
  update public.ending_condition_rows
  set sort_order = sort_order + 1
  where condition_block_id = v_original.condition_block_id
    and sort_order > v_original.sort_order;

  -- Insert the new row right after the original.
  insert into public.ending_condition_rows (id, condition_block_id, sort_order)
  values (v_new_row_id, v_original.condition_block_id, v_original.sort_order + 1);

  -- Clone the chips on the original row.
  insert into public.ending_condition_row_chips
    (row_id, variable_id, operator, text_value_id, number_value,
     aggregate_value, sort_order)
  select v_new_row_id, variable_id, operator, text_value_id, number_value,
         aggregate_value, sort_order
  from public.ending_condition_row_chips
  where row_id = p_row_id;

  -- Collect the block subtree rooted at the original row's direct child
  -- blocks (and everything beneath them).
  create temp table _dup_block_map (
    old_id uuid primary key,
    new_id uuid not null default gen_random_uuid()
  ) on commit drop;
  insert into _dup_block_map (old_id)
  with recursive block_tree (id) as (
    select id from public.ending_blocks where parent_row_id = p_row_id
    union all
    select b.id
    from public.ending_blocks b
    join public.ending_condition_rows r on r.id = b.parent_row_id
    join block_tree t on t.id = r.condition_block_id
  )
  select id from block_tree;

  -- Every row under a collected block.
  create temp table _dup_row_map (
    old_id uuid primary key,
    new_id uuid not null default gen_random_uuid()
  ) on commit drop;
  insert into _dup_row_map (old_id)
  select id from public.ending_condition_rows
  where condition_block_id in (select old_id from _dup_block_map);

  -- Clone the descendant blocks. A block directly under the original row
  -- re-parents to the new row but keeps its (unchanged) parent block;
  -- deeper blocks get parent block + row remapped.
  insert into public.ending_blocks
    (id, document_id, parent_block_id, parent_row_id, sort_order,
     block_type, text, result_value, summary)
  select
    bm.new_id,
    b.document_id,
    coalesce(pbm.new_id, b.parent_block_id),
    case when b.parent_row_id = p_row_id then v_new_row_id else prm.new_id end,
    b.sort_order,
    b.block_type, b.text, b.result_value, b.summary
  from public.ending_blocks b
  join _dup_block_map bm on bm.old_id = b.id
  left join _dup_block_map pbm on pbm.old_id = b.parent_block_id
  left join _dup_row_map prm on prm.old_id = b.parent_row_id;

  -- Clone the descendant rows.
  insert into public.ending_condition_rows (id, condition_block_id, sort_order)
  select rm.new_id, bm.new_id, r.sort_order
  from public.ending_condition_rows r
  join _dup_row_map rm on rm.old_id = r.id
  join _dup_block_map bm on bm.old_id = r.condition_block_id;

  -- Clone the descendant chips.
  insert into public.ending_condition_row_chips
    (row_id, variable_id, operator, text_value_id, number_value,
     aggregate_value, sort_order)
  select rm.new_id, c.variable_id, c.operator, c.text_value_id,
         c.number_value, c.aggregate_value, c.sort_order
  from public.ending_condition_row_chips c
  join _dup_row_map rm on rm.old_id = c.row_id;

  -- Clone the descendant header variables.
  insert into public.ending_condition_block_variables
    (condition_block_id, variable_id, sort_order)
  select bm.new_id, v.variable_id, v.sort_order
  from public.ending_condition_block_variables v
  join _dup_block_map bm on bm.old_id = v.condition_block_id;

  return v_new_row_id;
end;
$$;

grant execute on function public.duplicate_ending_block(uuid) to authenticated;
grant execute on function public.duplicate_ending_row(uuid) to authenticated;
