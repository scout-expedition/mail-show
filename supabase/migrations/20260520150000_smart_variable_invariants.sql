-- Smart Variables: enforce structural invariants + provide an atomic
-- result-rename RPC.
--
-- Three pieces, each independently idempotent:
--   1. UNIQUE (smart_variable_doc_id) on ending_variables so the 1:1
--      pairing between a smart_variable doc and its smart_ref row is
--      hard-locked at the DB layer.
--   2. Trigger that validates the referenced document's kind on insert
--      or update of `smart_variable_doc_id` — a smart_ref row can only
--      point at a kind='smart_variable' document.
--   3. RPC `update_smart_variable_block_result(p_block_id, p_new_value)`
--      that updates a smart_variable result/fallback block and migrates
--      every chip referencing the OLD value to the new value, in a
--      single transaction. Replaces the multi-await app-side path that
--      was previously susceptible to mid-rename failures.

-- 1) UNIQUE pairing.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ending_variables_smart_variable_doc_id_unique'
  ) then
    alter table public.ending_variables
      add constraint ending_variables_smart_variable_doc_id_unique
        unique (smart_variable_doc_id);
  end if;
end $$;

-- 2) Kind validation trigger.
--
-- A smart_ref ending_variable must point at a kind='smart_variable'
-- ending_document. Enforced via trigger because CHECK constraints
-- can't reference other tables. Trigger fires only when the FK column
-- is being set or changed, so unrelated updates stay cheap.
create or replace function public.validate_smart_variable_doc_kind()
returns trigger
language plpgsql
as $$
declare
  v_kind text;
begin
  if new.smart_variable_doc_id is null then
    return new;
  end if;
  select kind into v_kind
    from public.ending_documents
    where id = new.smart_variable_doc_id;
  if v_kind is null then
    raise exception 'smart_variable_doc_id % does not reference any ending_documents row',
      new.smart_variable_doc_id;
  end if;
  if v_kind <> 'smart_variable' then
    raise exception
      'smart_variable_doc_id % points at a document of kind=%, expected smart_variable',
      new.smart_variable_doc_id, v_kind;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_smart_variable_doc_kind
  on public.ending_variables;
create trigger trg_validate_smart_variable_doc_kind
  before insert or update of smart_variable_doc_id on public.ending_variables
  for each row
  when (new.smart_variable_doc_id is not null)
  execute function public.validate_smart_variable_doc_kind();

-- 3) Atomic rename RPC.
--
-- Updates a smart_variable result/fallback block's result_value AND
-- migrates every chip referencing the OLD value to the new one when
-- (a) old + new are both non-empty and distinct AND (b) no other
-- block in the same doc still produces the old value. The whole thing
-- runs as one transaction so a failure rolls back cleanly.
--
-- Callers responsible for the leaf-vs-kind shape validation
-- (validateResultValue stays in app code, runs before this RPC).
-- Non-smart_variable doc kinds short-circuit out — the regular
-- block-update path still applies for them.
create or replace function public.update_smart_variable_block_result(
  p_block_id uuid,
  p_new_value text
) returns void
language plpgsql
as $$
declare
  v_doc_id uuid;
  v_block_type text;
  v_old_value text;
  v_kind text;
  v_still_produced boolean;
  v_paired_var_id uuid;
begin
  select b.document_id, b.block_type, b.result_value, d.kind
    into v_doc_id, v_block_type, v_old_value, v_kind
    from public.ending_blocks b
    join public.ending_documents d on d.id = b.document_id
    where b.id = p_block_id
    for update of b;
  if not found then
    raise exception 'Unknown block %', p_block_id;
  end if;
  if v_kind <> 'smart_variable' then
    raise exception
      'update_smart_variable_block_result called on a kind=% block',
      v_kind;
  end if;
  if v_block_type not in ('result','fallback') then
    raise exception
      'update_smart_variable_block_result called on a block_type=% block',
      v_block_type;
  end if;

  update public.ending_blocks
    set result_value = p_new_value
    where id = p_block_id;

  if v_old_value is null or v_old_value = '' then
    return;
  end if;
  if p_new_value is null or p_new_value = '' then
    return;
  end if;
  if v_old_value = p_new_value then
    return;
  end if;

  select exists (
    select 1 from public.ending_blocks
      where document_id = v_doc_id
        and block_type in ('result','fallback')
        and result_value = v_old_value
        and id <> p_block_id
  ) into v_still_produced;
  if v_still_produced then
    return;
  end if;

  select id into v_paired_var_id
    from public.ending_variables
    where smart_variable_doc_id = v_doc_id
      and kind = 'smart_ref'
    limit 1;
  if v_paired_var_id is null then
    return;
  end if;

  update public.ending_condition_row_chips
    set aggregate_value = p_new_value
    where variable_id = v_paired_var_id
      and aggregate_value = v_old_value;
end;
$$;
