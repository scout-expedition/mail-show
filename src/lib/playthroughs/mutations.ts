/**
 * Client-agnostic domain helpers for playthrough mutations.
 *
 * These functions accept a Supabase client so they can be called from both
 * cookie-bound Server Actions (via createSupabaseServerClient) and the
 * service-role inbound API route (via createSupabaseServiceClient). They
 * contain no "use server" directive and perform no revalidatePath/redirect
 * calls — those stay in the Server Action wrappers that call these helpers.
 */

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Phase } from "@/lib/db/enums";

export type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// ---------------------------------------------------------------------------
// chooseAction
// ---------------------------------------------------------------------------

export interface ChooseActionInput {
  playthroughId: string;
  inspectionLetterId: string;
  chosenActionId: string;
}

export async function chooseAction(
  client: SupabaseClient,
  input: ChooseActionInput
): Promise<void> {
  const { playthroughId, inspectionLetterId, chosenActionId } = input;
  const { error } = await client.from("playthrough_action_choices").upsert(
    {
      playthrough_id: playthroughId,
      inspection_letter_id: inspectionLetterId,
      chosen_action_id: chosenActionId,
    },
    { onConflict: "playthrough_id,inspection_letter_id" }
  );
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// deliverLetter / flagLetter
// ---------------------------------------------------------------------------

export interface DeliverLetterInput {
  playthroughId: string;
  inspectionLetterId: string;
}

/**
 * Find (or lazily insert) the per-letter action row whose action_template
 * matches the canonical "Deliver" template, then record the choice.
 * Returns the action row id used.
 */
export async function deliverLetter(
  client: SupabaseClient,
  input: DeliverLetterInput
): Promise<{ actionId: string }> {
  return _findOrCreateTemplateAction(client, input, "Deliver");
}

/**
 * Find (or lazily insert) the per-letter action row whose action_template
 * matches the canonical "Flag" template, then record the choice.
 * Returns the action row id used.
 */
export async function flagLetter(
  client: SupabaseClient,
  input: DeliverLetterInput
): Promise<{ actionId: string }> {
  return _findOrCreateTemplateAction(client, input, "Flag");
}

/**
 * Shared implementation for deliverLetter and flagLetter.
 *
 * Lookup chain:
 *   1. Find the action_template row with lower(name) = lower(templateName).
 *   2. Look for an existing actions row for (inspection_letter_id, action_template_id).
 *   3. If none, insert a minimal actions row (all 9 impact_* default to 0,
 *      sort_order = max(sort_order)+1 for the letter's actions).
 *   4. Record the choice via the same upsert as chooseAction().
 */
async function _findOrCreateTemplateAction(
  client: SupabaseClient,
  input: DeliverLetterInput,
  templateName: "Deliver" | "Flag"
): Promise<{ actionId: string }> {
  const { playthroughId, inspectionLetterId } = input;

  // 1. Resolve the template id.
  const { data: tpl, error: tplError } = await client
    .from("action_templates")
    .select("id")
    .ilike("name", templateName)
    .single();
  if (tplError || !tpl) {
    throw new Error(
      `action_templates row for "${templateName}" not found: ${tplError?.message ?? "no row"}`
    );
  }
  const templateId = tpl.id as string;

  // 2. Look for an existing action row.
  const { data: existing, error: lookupError } = await client
    .from("actions")
    .select("id")
    .eq("inspection_letter_id", inspectionLetterId)
    .eq("action_template_id", templateId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  let actionId: string;

  if (existing) {
    actionId = existing.id as string;
  } else {
    // 3. Determine next sort_order for this letter's actions.
    const { data: maxRow, error: maxError } = await client
      .from("actions")
      .select("sort_order")
      .eq("inspection_letter_id", inspectionLetterId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw new Error(maxError.message);

    const nextSortOrder = ((maxRow?.sort_order as number | null) ?? 0) + 1;

    // 4. Insert a minimal action row (impact_* default to 0 in the DB schema).
    const { data: inserted, error: insertError } = await client
      .from("actions")
      .insert({
        inspection_letter_id: inspectionLetterId,
        action_template_id: templateId,
        sort_order: nextSortOrder,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(
        `Failed to insert "${templateName}" action row: ${insertError?.message ?? "no row returned"}`
      );
    }
    actionId = inserted.id as string;
  }

  // 5. Record the choice.
  await chooseAction(client, {
    playthroughId,
    inspectionLetterId,
    chosenActionId: actionId,
  });

  return { actionId };
}

// ---------------------------------------------------------------------------
// clearChoice
// ---------------------------------------------------------------------------

export interface ClearChoiceInput {
  playthroughId: string;
  inspectionLetterId: string;
}

export async function clearChoice(
  client: SupabaseClient,
  input: ClearChoiceInput
): Promise<void> {
  const { playthroughId, inspectionLetterId } = input;
  const { error } = await client
    .from("playthrough_action_choices")
    .delete()
    .eq("playthrough_id", playthroughId)
    .eq("inspection_letter_id", inspectionLetterId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// setCurrentDay
// ---------------------------------------------------------------------------

export interface SetCurrentDayInput {
  playthroughId: string;
  currentDayId: string | null;
  currentPhase: Phase;
}

export async function setCurrentDay(
  client: SupabaseClient,
  input: SetCurrentDayInput
): Promise<void> {
  const { playthroughId, currentDayId, currentPhase } = input;
  const { error } = await client
    .from("playthroughs")
    .update({ current_day_id: currentDayId, current_phase: currentPhase })
    .eq("id", playthroughId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Phase timer mutations
// ---------------------------------------------------------------------------

export interface StartPhaseInput {
  playthroughId: string;
  /** Optional override for clock-skew tests; defaults to now(). */
  startedAt?: string;
}

/**
 * Mark a phase as started. Clears phase_paused_at in case the phase had
 * been paused, then sets phase_started_at to the provided timestamp or now.
 */
export async function startPhase(
  client: SupabaseClient,
  input: StartPhaseInput
): Promise<void> {
  const { playthroughId, startedAt } = input;
  const { error } = await client
    .from("playthroughs")
    .update({
      phase_started_at: startedAt ?? new Date().toISOString(),
      phase_paused_at: null,
    })
    .eq("id", playthroughId);
  if (error) throw new Error(error.message);
}

export interface PausePhaseInput {
  playthroughId: string;
  /** Optional override for clock-skew tests; defaults to now(). */
  pausedAt?: string;
}

/** Record the wall-clock time the phase was paused. */
export async function pausePhase(
  client: SupabaseClient,
  input: PausePhaseInput
): Promise<void> {
  const { playthroughId, pausedAt } = input;
  const { error } = await client
    .from("playthroughs")
    .update({ phase_paused_at: pausedAt ?? new Date().toISOString() })
    .eq("id", playthroughId);
  if (error) throw new Error(error.message);
}

/** Resume a paused phase — clears phase_paused_at; phase_started_at remains. */
export async function resumePhase(
  client: SupabaseClient,
  input: { playthroughId: string }
): Promise<void> {
  const { playthroughId } = input;
  const { error } = await client
    .from("playthroughs")
    .update({ phase_paused_at: null })
    .eq("id", playthroughId);
  if (error) throw new Error(error.message);
}
