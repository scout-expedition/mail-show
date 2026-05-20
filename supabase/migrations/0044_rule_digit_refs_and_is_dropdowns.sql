-- 0044 — Sorting-rule comparator polish (round 2).
--
-- Adds two reference types so the citizen-id and city-code first/last char
-- pickers can offer "this number" (1-digit value-equals) and "these numbers"
-- (digit-set membership), mirroring `string` ("this letter") and `letter_set`
-- ("these letters"). Existing `letter_set` rows continue to work — `digit_set`
-- is a separate type so the picker can present a distinct label and the input
-- can mask to 0–9.
--
-- Also migrates existing `nation` and `current_day_of_week` conditions from
-- `operator = equals` to `operator = is`, since both are now predetermined-set
-- pickers (matrix change in `src/lib/rules/normalize.ts`). Idempotent: a re-run
-- updates zero rows.

-- Enum ADD VALUEs first; they must commit before any statement can reference them.
alter type public.rule_reference_type add value if not exists 'digit';
alter type public.rule_reference_type add value if not exists 'digit_set';

-- Migrate legacy operator usage on nation / day targets to the new `is` semantic.
-- (No effect on reference_type / reference_value — those carry over verbatim.)
update public.sorting_rule_conditions
set operator = 'is'
where operator = 'equals'
  and target in (
    'sender_nation',
    'recipient_nation',
    'current_day_of_week'
  );
