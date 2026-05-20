-- 0041_rule_target_name_parts.sql
--
-- Adds the six structured name-part values to the rule_target enum so a
-- sorting rule condition can target a sender/recipient first, middle, or last
-- name. The name data resolves at evaluation time from the citizen linked to
-- the sorting letter (citizens already carry first/middle/last name) — no
-- sorting_letters schema change is needed.
--
-- Separate file from 0042 because `ALTER TYPE ... ADD VALUE` cannot be used in
-- the same transaction that adds it; 0042 uses these values in an UPDATE.
-- Idempotent via `if not exists`.

alter type public.rule_target add value if not exists 'sender_first_name';
alter type public.rule_target add value if not exists 'sender_middle_name';
alter type public.rule_target add value if not exists 'sender_last_name';
alter type public.rule_target add value if not exists 'recipient_first_name';
alter type public.rule_target add value if not exists 'recipient_middle_name';
alter type public.rule_target add value if not exists 'recipient_last_name';
