-- Endings logic v2: fallback block on the framework_selection document.
--
-- A fallback block sits pinned at the bottom of the framework_selection
-- doc's root level. If no row in the chip-row tree returns a result,
-- the evaluator returns the fallback's result_value (a framework
-- document_id). The block is auto-created, can't be deleted by the
-- author, can't be moved, and can't have anything after it. Its
-- result_value is null until the author picks a framework.
--
-- Idempotent-friendly per project convention.

-- 1) Drop existing block_type CHECK + payload CHECK so we can rebuild
-- them widened for the new block_type. The column-level block_type
-- check is auto-named; look it up by definition.
do $$
declare con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    where r.relname = 'ending_blocks'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%block_type%'
      and pg_get_constraintdef(c.oid) ilike '%text%'
      and pg_get_constraintdef(c.oid) ilike '%result%'
      and pg_get_constraintdef(c.oid) not ilike '%fallback%'
  loop
    execute format('alter table public.ending_blocks drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.ending_blocks
  drop constraint if exists ending_blocks_type_payload;
alter table public.ending_blocks
  drop constraint if exists ending_blocks_block_type_check;

-- 2) Re-add CHECKs widened for 'fallback'. Fallback blocks have no
-- text; result_value is nullable (unset until the author picks a
-- framework).
alter table public.ending_blocks
  add constraint ending_blocks_block_type_check
    check (block_type in ('text','condition','result','fallback'));

alter table public.ending_blocks
  add constraint ending_blocks_type_payload check (
    (block_type = 'text'      and text is not null         and result_value is null)
    or (block_type = 'result'   and result_value is not null and text is null)
    or (block_type = 'condition' and text is null          and result_value is null)
    or (block_type = 'fallback' and text is null)
  );

-- 3) Fallback blocks must be at the document root (no parent).
alter table public.ending_blocks
  drop constraint if exists ending_blocks_fallback_root_only;
alter table public.ending_blocks
  add constraint ending_blocks_fallback_root_only check (
    block_type <> 'fallback'
    or (parent_block_id is null and parent_row_id is null)
  );

-- 4) At most one fallback block per document. Partial unique index
-- on document_id where block_type='fallback'.
drop index if exists ending_blocks_fallback_singleton;
create unique index ending_blocks_fallback_singleton
  on public.ending_blocks(document_id)
  where block_type = 'fallback';

-- 5) Backfill: insert a fallback block for the existing
-- framework_selection doc with a sort_order well past any user blocks.
-- The unique index makes re-applies a no-op.
insert into public.ending_blocks (document_id, block_type, sort_order)
select id, 'fallback', 999999
from public.ending_documents
where kind = 'framework_selection'
on conflict do nothing;
