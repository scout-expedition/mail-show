-- 0036_endings_block_summary.sql
--
-- Adds an authoring-only `summary` label to ending_blocks. Surfaced in
-- the condition + text block headers between the variable pills and the
-- kebab; remains visible when the block is collapsed. Optional, never
-- read by the evaluator — purely a scanning aid for authors.
--
-- The existing `ending_blocks_type_payload` CHECK constraint only
-- references `block_type`, `text`, and `result_value`, so a new nullable
-- column is allowed for every block_type without rewriting the check.

alter table public.ending_blocks
  add column if not exists summary text;
