-- C5 — advance_phase(p_id, expected_phase) RPC.
--
-- Atomic phase advancement. Locks the playthrough row, verifies the
-- caller's idempotency token matches `current_phase`, closes the open
-- playthrough_phase_log row, opens a new one for the target phase, and
-- handles two phase-boundary side effects:
--
--   - Exiting inspection: auto-applies fallback action choices for any
--     delivered letter that the player left unanswered when the letter
--     has `inspection_letters.fallback_mirror_action_id` set. Inserts
--     with `applied_via_fallback = true`. Letters with NULL fallback
--     remain unset (no impact).
--
--   - Entering top_of_day: records which report segments fired in the
--     prior day's inspection by walking the playthrough's choices on
--     prior-day deliveries and inserting one row per chosen action's
--     `report_segment_id` into playthrough_report_segments_fired
--     (ON CONFLICT DO NOTHING — entering TOD twice is idempotent).
--
-- Also tracks furthest progress (drives the forward-button visibility
-- once Track D lands) and resets the phase clock columns. Top-of-day
-- and end-of-day are untimed; the phase log row's allotted_ms is null
-- for those.
--
-- Mismatched idempotency token → no-op (returns false). All-or-nothing
-- per the surrounding transaction.

create or replace function public.advance_phase(
  p_id uuid,
  expected_phase public.phase
)
returns boolean
language plpgsql
as $$
declare
  p_row public.playthroughs%rowtype;
  prior_day_id uuid;
  prior_day_number int;
  target_day_id uuid;
  target_phase public.phase;
  target_allotted_ms bigint;
  next_day_row record;
  cur_phase_elapsed_ms bigint;
  cur_phase_allotted_ms bigint;
  cur_phase_overtime_ms bigint;
begin
  -- 1) Lock the playthrough row.
  select * into p_row from public.playthroughs where id = p_id for update;
  if not found then
    return false;
  end if;

  -- 2) Idempotency: a stale tab that races with another advance hits a
  -- non-matching expected_phase and bails. Returning false (not raising)
  -- lets the caller treat it as "someone else moved it; just refresh".
  if p_row.current_phase <> expected_phase then
    return false;
  end if;

  -- 3) Compute the target (day, phase) pair.
  if p_row.current_phase = 'top_of_day' then
    target_day_id := p_row.current_day_id;
    target_phase := 'sorting';
  elsif p_row.current_phase = 'sorting' then
    target_day_id := p_row.current_day_id;
    target_phase := 'inspection';
  elsif p_row.current_phase = 'inspection' then
    target_day_id := p_row.current_day_id;
    target_phase := 'end_of_day';
  else
    -- end_of_day → next day's top_of_day. Find day with number = current+1.
    select d.id, d.number
      into next_day_row
      from public.days d
      where d.number = (select number from public.days where id = p_row.current_day_id) + 1
      limit 1;
    if not found then
      -- Final EOD; no next day to advance to. Track E owns endPlaythrough.
      return false;
    end if;
    target_day_id := next_day_row.id;
    target_phase := 'top_of_day';
  end if;

  -- 4) Close the prior playthrough_phase_log row (the one for the phase
  -- we're LEAVING). The partial unique index playthrough_phase_log_one_open
  -- guarantees at most one match.
  cur_phase_elapsed_ms := case
    when p_row.phase_started_at is null then 0
    else greatest(0, (extract(epoch from (now() - p_row.phase_started_at)) * 1000)::bigint
                     - p_row.phase_total_paused_ms)
  end;

  cur_phase_allotted_ms := coalesce(
    p_row.phase_allotted_override_ms,
    case p_row.current_phase
      when 'sorting' then (select sort_phase_length_seconds * 1000
                             from public.days where id = p_row.current_day_id)::bigint
      when 'inspection' then (select inspection_phase_length_seconds * 1000
                                from public.days where id = p_row.current_day_id)::bigint
      else null
    end
  );

  cur_phase_overtime_ms := case
    when cur_phase_allotted_ms is null then null
    else greatest(0, cur_phase_elapsed_ms - cur_phase_allotted_ms)
  end;

  update public.playthrough_phase_log
    set exited_at = now(),
        elapsed_ms = cur_phase_elapsed_ms,
        allotted_ms = cur_phase_allotted_ms,
        overtime_ms = cur_phase_overtime_ms
    where playthrough_id = p_id
      and superseded_at is null
      and exited_at is null;

  -- 5) Exiting inspection — auto-apply fallback action choices for any
  -- delivered letter the player left unanswered whose letter has a
  -- fallback_mirror_action_id set. Pulls the same delivered set the UI
  -- uses (scheduled + branch via playthrough_delivered_letters_view).
  if p_row.current_phase = 'inspection' then
    insert into public.playthrough_action_choices
      (playthrough_id, inspection_letter_id, chosen_action_id, applied_via_fallback)
    select p_id, il.id, il.fallback_mirror_action_id, true
    from public.playthrough_delivered_letters_view dlv
    join public.inspection_letters il on il.id = dlv.id
    where dlv.playthrough_id = p_id
      and il.fallback_mirror_action_id is not null
      and not exists (
        select 1 from public.playthrough_action_choices pac
        where pac.playthrough_id = p_id
          and pac.inspection_letter_id = il.id
      );
  end if;

  -- 6) Compute target phase's allotted_ms for the new log row.
  target_allotted_ms := case target_phase
    when 'sorting' then (select sort_phase_length_seconds * 1000
                           from public.days where id = target_day_id)::bigint
    when 'inspection' then (select inspection_phase_length_seconds * 1000
                              from public.days where id = target_day_id)::bigint
    else null
  end;

  -- 7) Open the new playthrough_phase_log row.
  insert into public.playthrough_phase_log
    (playthrough_id, day_id, phase, entered_at, allotted_ms)
    values (p_id, target_day_id, target_phase, now(), target_allotted_ms);

  -- 8) Entering top_of_day — record fired report segments. The morning
  -- report for the target day reflects choices made during the PRIOR
  -- day's inspection. Find prior_day by number.
  if target_phase = 'top_of_day' then
    select id, number
      into prior_day_id, prior_day_number
      from public.days
      where number = (select number from public.days where id = target_day_id) - 1
      limit 1;
    if prior_day_id is not null then
      insert into public.playthrough_report_segments_fired
        (playthrough_id, day_id, report_segment_id)
      select p_id, target_day_id, a.report_segment_id
      from public.playthrough_action_choices pac
      join public.actions a on a.id = pac.chosen_action_id
      join public.inspection_letters il on il.id = pac.inspection_letter_id
      join public.inspection_letters_view ilv on ilv.id = il.id
      where pac.playthrough_id = p_id
        and a.report_segment_id is not null
        and ilv.effective_day_id = prior_day_id
      on conflict (playthrough_id, day_id, report_segment_id) do nothing;
    end if;
  end if;

  -- 9) Update playthroughs row: cursor + furthest + reset phase clock.
  -- "Greater" target is later by (day.number, phase ordinal). Postgres
  -- enums sort by declaration order; the phase enum was declared
  -- top_of_day,sorting,inspection,end_of_day — so the comparison works.
  update public.playthroughs
    set current_day_id = target_day_id,
        current_phase = target_phase,
        phase_started_at = now(),
        phase_total_paused_ms = 0,
        phase_paused_at = null,
        phase_allotted_override_ms = null,
        furthest_day_id = case
          when furthest_day_id is null then target_day_id
          when (select number from public.days where id = target_day_id)
               > (select number from public.days where id = furthest_day_id)
            then target_day_id
          when (select number from public.days where id = target_day_id)
               = (select number from public.days where id = furthest_day_id)
               and target_phase > coalesce(furthest_phase, 'top_of_day')
            then target_day_id
          else furthest_day_id
        end,
        furthest_phase = case
          when furthest_phase is null then target_phase
          when (select number from public.days where id = target_day_id)
               > (select number from public.days where id = coalesce(furthest_day_id, target_day_id))
            then target_phase
          when (select number from public.days where id = target_day_id)
               = (select number from public.days where id = coalesce(furthest_day_id, target_day_id))
               and target_phase > furthest_phase
            then target_phase
          else furthest_phase
        end
    where id = p_id;

  return true;
end;
$$;
