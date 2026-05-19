-- 0045 — Sorting rules: third match mode `exclusive` ("Or").
--
-- `all` (And) — every condition must be true.
-- `any` (And/Or) — at least one condition must be true.
-- `exclusive` (Or) — EXACTLY one condition must be true (XOR over the set);
--                    zero true fails, more than one true fails.
--
-- Additive ALTER TYPE ADD VALUE — existing rows are unaffected, and the value
-- can be deployed independently of the editor change.

alter type public.rule_match_mode add value if not exists 'exclusive';
