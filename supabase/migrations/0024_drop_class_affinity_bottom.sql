-- Drop the class_affinity_bottom seeded document.
--
-- Class affinity has only 2 options (proletariat, gentry). Once a tie
-- resolves "who's on top", the bottom is automatically the other one,
-- so a separate bottom-tiebreak document is redundant. The evaluator
-- gets an invert flag on the side lookup; the schema just needs to
-- stop seeding the redundant doc.
--
-- The `class_affinity_bottom` value remains in the
-- `ending_document_kind` enum (dropping enum values cleanly requires a
-- type-rebuild dance not worth doing for a value the app side won't
-- emit anymore). No new docs of that kind can be created since the
-- app's ENDING_DOCUMENT_KINDS array no longer lists it.
--
-- Idempotent-friendly per project convention.

delete from public.ending_documents
where kind = 'class_affinity_bottom';
