-- 0043_rule_operator_comparator_revamp.sql
--
-- Adds the operators and reference type required by the per-target
-- operator/comparator matrix introduced with the sorting-rules revamp phase 2:
--   * rule_operator gets `not_equals` (≠), `not_contains` ("does not contain"),
--     and `is_not` — explicit negations needed by the new matrix.
--   * rule_reference_type gets `letter_set` — the "these letters" comparator,
--     a comma-joined character set tested by `is` / `is_not` for set membership
--     of the sliced character (first_char / last_char).
--
-- Fully additive — no data migration. Idempotent via `if not exists` on the
-- enum additions.

alter type public.rule_operator add value if not exists 'not_equals';
alter type public.rule_operator add value if not exists 'not_contains';
alter type public.rule_operator add value if not exists 'is_not';

alter type public.rule_reference_type add value if not exists 'letter_set';
