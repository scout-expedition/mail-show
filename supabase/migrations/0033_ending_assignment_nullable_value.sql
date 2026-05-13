-- Allow `value_id` on inspection_action_ending_assignments to be null so a
-- peer can save an ending-variable assignment as soon as they pick the
-- variable, without being forced to also pick a value at the same time.
-- The previous NOT NULL constraint caused the local-only in-progress row
-- (variable set, value unset) to be silently dropped by the
-- replace-then-insert patch path, which manifested as "dropdown briefly
-- appears then disappears" when adding multiple ending variables.
--
-- The action_id + variable_id uniqueness invariant stays — assignments
-- are still scoped one-per-variable per action.
--
-- Idempotent: `set not null` is a no-op when the column is already nullable.

alter table public.inspection_action_ending_assignments
  alter column value_id drop not null;
