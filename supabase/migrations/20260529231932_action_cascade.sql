-- Track D — cascade_action_change(p_id, changed_letter_id, old_action_id)
--
-- Called by chooseAction / clearChoice when the player modifies a choice
-- while viewing a past phase (current < furthest). The cascade:
--
--   1) Walks the downstream letter chain from the old action's
--      next_letter_id (recursive CTE over actions.next_letter_id).
--
--   2) Moves any playthrough_action_choices for those downstream letters
--      into playthrough_action_choice_history (audit trail), then deletes
--      the live choices.
--
--   3) Supersedes all playthrough_phase_log rows for (day, phase) combos
--      that come strictly AFTER the playthrough's current position.
--      This forces re-advancement via advancePhase which creates fresh
--      log rows with accurate timing.
--
--   4) Clears playthrough_report_segments_fired for days after the
--      current day (those will be re-populated by advancePhase when
--      entering the next top_of_day).
--
--   5) Resets furthest_day_id / furthest_phase to the current cursor
--      position. The forward button disappears; the player must re-advance.

create or replace function public.cascade_action_change(
  p_id uuid,
  changed_letter_id uuid,
  old_action_id uuid
)
returns void
language plpgsql
as $$
declare
  p_row public.playthroughs%rowtype;
  cur_day_number int;
begin
  -- Lock the playthrough row.
  select * into p_row from public.playthroughs where id = p_id for update;
  if not found then
    return;
  end if;

  select number into cur_day_number
    from public.days where id = p_row.current_day_id;

  -- 1+2) Walk downstream letters from the old action's next_letter chain,
  --      archive affected choices, then delete them.
  with recursive downstream as (
    select a.next_letter_id as letter_id
    from public.actions a
    where a.id = old_action_id
      and a.next_letter_id is not null

    union

    select a2.next_letter_id as letter_id
    from downstream d
    join public.playthrough_action_choices pac
      on pac.playthrough_id = p_id
      and pac.inspection_letter_id = d.letter_id
    join public.actions a2
      on a2.id = pac.chosen_action_id
      and a2.next_letter_id is not null
  )
  insert into public.playthrough_action_choice_history
    (playthrough_id, inspection_letter_id, chosen_action_id, set_at, unset_at, was_fallback)
  select pac.playthrough_id, pac.inspection_letter_id, pac.chosen_action_id,
         now(), now(), pac.applied_via_fallback
  from public.playthrough_action_choices pac
  join downstream d on d.letter_id = pac.inspection_letter_id
  where pac.playthrough_id = p_id;

  -- Delete the live choices for downstream letters.
  with recursive downstream as (
    select a.next_letter_id as letter_id
    from public.actions a
    where a.id = old_action_id
      and a.next_letter_id is not null

    union

    select a2.next_letter_id as letter_id
    from downstream d
    join public.playthrough_action_choices pac
      on pac.playthrough_id = p_id
      and pac.inspection_letter_id = d.letter_id
    join public.actions a2
      on a2.id = pac.chosen_action_id
      and a2.next_letter_id is not null
  )
  delete from public.playthrough_action_choices pac
  using downstream d
  where pac.playthrough_id = p_id
    and pac.inspection_letter_id = d.letter_id;

  -- 3) Supersede phase-log rows strictly after the current position.
  update public.playthrough_phase_log ppl
    set superseded_at = now()
    where ppl.playthrough_id = p_id
      and ppl.superseded_at is null
      and (
        (select number from public.days where id = ppl.day_id) > cur_day_number
        or (
          ppl.day_id = p_row.current_day_id
          and ppl.phase > p_row.current_phase
        )
      );

  -- 4) Clear fired report segments for days after the current day.
  delete from public.playthrough_report_segments_fired prsf
    where prsf.playthrough_id = p_id
      and (select number from public.days where id = prsf.day_id) > cur_day_number;

  -- 5) Reset furthest to current position.
  update public.playthroughs
    set furthest_day_id = current_day_id,
        furthest_phase = current_phase
    where id = p_id;
end;
$$;
