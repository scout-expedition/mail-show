-- Seed a fallback block on the class_affinity_top document, matching
-- the framework_selection fallback shape. When the chip-row tree on the
-- class affinity tiebreak doesn't return a result, the evaluator falls
-- back to this block's result_value (one of the class options:
-- proletariat or gentry, internally; "Working Class" / "Upper Class"
-- as labels).
--
-- 0023 already widened the schema to support fallback blocks (block_type
-- includes 'fallback'; partial unique enforces one per document; CHECKs
-- pin them to the document root). This migration only adds the seeded
-- row for the class_affinity_top document.
--
-- Idempotent-friendly per project convention.

insert into public.ending_blocks (document_id, block_type, sort_order)
select id, 'fallback', 999999
from public.ending_documents
where kind = 'class_affinity_top'
on conflict do nothing;
