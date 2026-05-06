-- Seed fallback blocks on the nation_affinity_top and
-- nation_affinity_bottom documents, mirroring the class_affinity_top
-- fallback added in 0025. When the chip-row tree on a nation tiebreak
-- doesn't return a result, the evaluator falls back to this block's
-- result_value (one of the nation options: folos, emberlyn, spokgrad,
-- pelico, epicenter — or a random sentinel).
--
-- 0023 already widened the schema for fallback blocks (block_type
-- includes 'fallback'; partial unique enforces one per document; CHECKs
-- pin them to the document root). This migration only seeds the rows.
--
-- Idempotent-friendly per project convention.

insert into public.ending_blocks (document_id, block_type, sort_order)
select id, 'fallback', 999999
from public.ending_documents
where kind in ('nation_affinity_top', 'nation_affinity_bottom')
on conflict do nothing;
