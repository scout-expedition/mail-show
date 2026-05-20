-- Migrate citizen IDs from "#A1B2" to "A1B2" storage. The "#" is now a pure
-- display affordance, prepended by displayCitizenId() in the UI. Re-running
-- this migration is a no-op: the LIKE '#%' guard makes touched rows zero
-- on the second pass.
update public.citizens
set citizen_id = regexp_replace(citizen_id, '^#', '')
where citizen_id is not null
  and citizen_id like '#%';

-- Belt-and-suspenders: strip "#" from rule reference values that target a
-- whole citizen-id. Harmless no-op if no such rules exist (0 today).
update public.sorting_rule_conditions
set reference_value = regexp_replace(reference_value, '^#', '')
where reference_value like '#%'
  and target in ('sender_citizen_id', 'recipient_citizen_id')
  and target_slice = 'whole';
