-- One-time cleanup: clear actions.next_letter_variant pointers that no
-- longer match any letter in the next group of the same storyline. These
-- orphaned refs accumulated before deleteInspectionLetter / deleteGroup
-- learned to sweep them up; they render as a "missing" pill in the
-- inspector's action editor today.
--
-- For each action A on letter L (in group G of storyline S):
--   - If A.next_letter_variant is set,
--   - Find the next group N (storyline = S, sequence = G.sequence + lowest
--     positive delta).
--   - If no N exists, or N has no letter with variant = A.next_letter_variant,
--     null out A.next_letter_variant.
update public.actions a
set next_letter_variant = null
where a.next_letter_variant is not null
  and not exists (
    select 1
    from public.inspection_letters src_letter
    join public.letter_groups src_group on src_group.id = src_letter.letter_group_id
    join public.letter_groups next_group
      on next_group.storyline_id = src_group.storyline_id
     and next_group.sequence > src_group.sequence
    join public.inspection_letters next_letter
      on next_letter.letter_group_id = next_group.id
     and next_letter.variant = a.next_letter_variant
    where src_letter.id = a.inspection_letter_id
      and not exists (
        select 1
        from public.letter_groups intermediate
        where intermediate.storyline_id = src_group.storyline_id
          and intermediate.sequence > src_group.sequence
          and intermediate.sequence < next_group.sequence
      )
  );
