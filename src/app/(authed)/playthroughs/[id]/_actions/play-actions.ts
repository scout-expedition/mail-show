"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
