"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Phase } from "@/lib/db/enums";

/** Play-mode server actions. Hosts the per-letter action picker for now;
 *  Track A adds the timer ops (`startPlaythrough`, `pauseGame`, …) and
 *  Track C adds `advancePhase` / `goToPhase` / `endPlaythrough`. */

/** Revalidate every page that surfaces playthrough state. Called by any
 *  mutation that changes choices or (later) current_day/current_phase.
 *  Uses the bracketed pattern (`/playthroughs/[id]`, page-mode) so Next
 *  matches every dynamic instance — broader than the resolved-URL form. */
function revalidatePlayState() {
  revalidatePath("/");
  revalidatePath("/playthroughs");
  revalidatePath("/playthroughs/[id]", "page");
}

export async function chooseAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const playthrough_id = String(formData.get("playthrough_id") ?? "");
  const inspection_letter_id = String(formData.get("inspection_letter_id") ?? "");
  const chosen_action_id = String(formData.get("chosen_action_id") ?? "");
  if (!playthrough_id || !inspection_letter_id || !chosen_action_id) return;
  const { error } = await supabase.from("playthrough_action_choices").upsert(
    {
      playthrough_id,
      inspection_letter_id,
      chosen_action_id,
      applied_via_fallback: false,
    },
    { onConflict: "playthrough_id,inspection_letter_id" }
  );
  if (error) throw new Error(error.message);
  revalidatePlayState();
}

export async function clearChoice(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const playthrough_id = String(formData.get("playthrough_id") ?? "");
  const inspection_letter_id = String(formData.get("inspection_letter_id") ?? "");
  if (!playthrough_id || !inspection_letter_id) return;
  const { error } = await supabase
    .from("playthrough_action_choices")
    .delete()
    .eq("playthrough_id", playthrough_id)
    .eq("inspection_letter_id", inspection_letter_id);
  if (error) throw new Error(error.message);
  revalidatePlayState();
}

// ---------------------------------------------------------------------------
// Track A — Timer actions
// ---------------------------------------------------------------------------

/**
 * Start a playthrough for the first time. Sets `started=true`,
 * `started_at=now()`, `phase_started_at=now()`, advances to the first day
 * (lowest `number`), and sets `current_phase='top_of_day'`.
 *
 * Idempotent: if `started` is already true the row is left untouched and
 * no error is thrown.
 */
export async function startPlaythrough(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // Fetch the first day by number.
  const { data: firstDay, error: dayError } = await supabase
    .from("days")
    .select("id")
    .order("number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (dayError) throw new Error(dayError.message);

  const { error } = await supabase
    .from("playthroughs")
    .update({
      started: true,
      started_at: new Date().toISOString(),
      phase_started_at: new Date().toISOString(),
      current_day_id: firstDay?.id ?? null,
      current_phase: "top_of_day",
      paused_at: null,
      total_paused_ms: 0,
      phase_paused_at: null,
      phase_total_paused_ms: 0,
    })
    .eq("id", id)
    .eq("started", false); // guard: no-op if already started

  if (error) throw new Error(error.message);
  revalidatePlayState();
}

/**
 * Pause both the game clock and the phase clock atomically.
 * Delegates to the `pause_playthrough(p_id)` Postgres function which
 * handles the idempotency guard (no-op if already paused).
 */
export async function pauseGame(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("pause_playthrough", { p_id: id });
  if (error) throw new Error(error.message);
  revalidatePlayState();
}

/**
 * Resume both the game clock and the phase clock atomically.
 * Delegates to the `resume_playthrough(p_id)` Postgres function which
 * handles the idempotency guard (no-op if not currently paused).
 */
export async function resumeGame(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("resume_playthrough", { p_id: id });
  if (error) throw new Error(error.message);
  revalidatePlayState();
}

/**
 * Adjust the current phase's allotted time by `deltaMs` milliseconds.
 * Positive = more time; negative = less time (clamped to ≥ 0).
 *
 * Inserts an audit row into `playthrough_phase_timer_adjustments` and
 * updates `phase_allotted_override_ms` on the playthrough row. If no
 * override exists yet, the baseline is the day's default for the current
 * phase (resolved client-side and passed in as `currentAllottedMs`).
 */
export async function adjustPhaseAllotment(
  id: string,
  deltaMs: number,
  currentAllottedMs: number
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // Read the current playthrough to get current_day_id and current_phase
  // for the audit row, and phase_allotted_override_ms for the new value.
  const { data: playthrough, error: fetchError } = await supabase
    .from("playthroughs")
    .select("current_day_id, current_phase, phase_allotted_override_ms")
    .eq("id", id)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  // Compute the new override: start from the current override if set,
  // otherwise from the caller-supplied baseline (day default in ms).
  const baseMs =
    playthrough.phase_allotted_override_ms !== null
      ? playthrough.phase_allotted_override_ms
      : currentAllottedMs;
  const newAllottedMs = Math.max(0, baseMs + deltaMs);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Insert the audit row.
  const { error: insertError } = await supabase
    .from("playthrough_phase_timer_adjustments")
    .insert({
      playthrough_id: id,
      day_id: playthrough.current_day_id,
      phase: playthrough.current_phase,
      delta_ms: deltaMs,
      applied_by: user?.id ?? null,
    });

  if (insertError) throw new Error(insertError.message);

  // Apply the new override.
  const { error: updateError } = await supabase
    .from("playthroughs")
    .update({ phase_allotted_override_ms: newAllottedMs })
    .eq("id", id);

  if (updateError) throw new Error(updateError.message);
  revalidatePlayState();
}

/**
 * Restart the phase timer: resets `phase_started_at` to now and zeroes
 * `phase_total_paused_ms`. Simultaneously rewinds the game clock by the
 * elapsed phase time (so the time "given back" for the redo is not
 * double-counted on the game total). This is achieved by incrementing
 * `total_paused_ms` by the elapsed phase amount — semantically a
 * retroactive pause credit.
 *
 * The `elapsedPhaseMs` argument should be the current `phaseElapsedMs`
 * reading at the moment the user pressed restart (supplied from the
 * client-side timer display).
 */
export async function restartPhaseTimer(
  id: string,
  elapsedPhaseMs: number
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // Read current total_paused_ms to compute the new value.
  const { data: playthrough, error: fetchError } = await supabase
    .from("playthroughs")
    .select("total_paused_ms")
    .eq("id", id)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  // Rewind the game clock: credit the elapsed phase slice back as paused time.
  const newTotalPausedMs =
    playthrough.total_paused_ms + Math.max(0, elapsedPhaseMs);

  const { error } = await supabase
    .from("playthroughs")
    .update({
      phase_started_at: new Date().toISOString(),
      phase_total_paused_ms: 0,
      phase_paused_at: null,
      total_paused_ms: newTotalPausedMs,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePlayState();
}

// ---------------------------------------------------------------------------
// Track C5 — Phase advancement
// ---------------------------------------------------------------------------

/**
 * Advance the playthrough to the next phase. `expectedPhase` is an
 * idempotency token: if another tab already advanced past this phase the
 * RPC no-ops and this action returns without revalidating.
 *
 * The atomic SQL function (`advance_phase`) handles the phase-log
 * close/open, fallback auto-apply when exiting inspection, and
 * report-segments recording when entering top-of-day. See
 * `supabase/migrations/20260527185748_advance_phase_rpc.sql`.
 */
export async function advancePhase(
  id: string,
  expectedPhase: Phase
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("advance_phase", {
    p_id: id,
    expected_phase: expectedPhase,
  });
  if (error) throw new Error(error.message);
  // RPC returns false on idempotency mismatch (stale tab) — skip the
  // revalidate so we don't bust caches for a no-op.
  if (data === false) return;
  revalidatePlayState();
  // Phase transitions across TOD cross the days/[identifier]/top-of-day
  // route boundary; bust that too so the editor reflects the new state.
  revalidatePath("/days/[identifier]/top-of-day", "page");
}
