-- Bulk-update RPCs for sorting_rules. Both run as single UPDATE statements
-- so the unique(letter) constraint is checked once at statement end —
-- meaning any valid letter permutation works in one shot, no cycle-break
-- or spare-letter routing needed on the client.

-- Reorder: rewrites every rule's sort_order atomically. Used by drag-and-
-- drop reorder and the "Sort by ID" kebab.
create or replace function public.reorder_sorting_rules(updates jsonb, updated_by_email text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  total int;
  unique_ids int;
  unique_positions int;
begin
  select jsonb_array_length(updates) into total;
  select count(distinct u.value->>'id') into unique_ids
    from jsonb_array_elements(updates) u;
  select count(distinct (u.value->>'sort_order')::int) into unique_positions
    from jsonb_array_elements(updates) u;
  if total <> unique_ids then
    raise exception 'reorder_sorting_rules: duplicate rule IDs in updates';
  end if;
  if total <> unique_positions then
    raise exception 'reorder_sorting_rules: duplicate positions in updates';
  end if;

  update public.sorting_rules s
  set sort_order = (u.value->>'sort_order')::int,
      updated_by = coalesce(updated_by_email, s.updated_by)
  from jsonb_array_elements(updates) as u
  where s.id = (u.value->>'id')::uuid;
end;
$$;

-- Letter permutation: assigns new letters to a set of rules in one
-- transactional UPDATE. The "Edit ID" cascade and "Renumber Rules" both
-- precompute the full {id, letter} mapping client-side and call this once.
create or replace function public.apply_rule_letters(updates jsonb, updated_by_email text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  total int;
  unique_ids int;
  unique_letters int;
begin
  select jsonb_array_length(updates) into total;
  select count(distinct u.value->>'id') into unique_ids
    from jsonb_array_elements(updates) u;
  select count(distinct upper(u.value->>'letter')) into unique_letters
    from jsonb_array_elements(updates) u;
  if total <> unique_ids then
    raise exception 'apply_rule_letters: duplicate rule IDs in updates';
  end if;
  if total <> unique_letters then
    raise exception 'apply_rule_letters: duplicate target letters in updates';
  end if;

  update public.sorting_rules s
  set letter = upper(u.value->>'letter'),
      updated_by = coalesce(updated_by_email, s.updated_by)
  from jsonb_array_elements(updates) as u
  where s.id = (u.value->>'id')::uuid;
end;
$$;
