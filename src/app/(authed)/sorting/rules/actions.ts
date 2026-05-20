"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  RuleMatchMode,
  RuleOperator,
  RuleReferenceType,
  RuleTarget,
  RuleTargetSlice,
} from "@/lib/db/enums";
import { toStorageCitizenId } from "@/lib/citizen-id";

/** Lowest unused rule letter A–Z, or null when all 26 are taken. */
function nextFreeLetter(used: Set<string>): string | null {
  for (let c = 65; c <= 90; c++) {
    const ch = String.fromCharCode(c);
    if (!used.has(ch)) return ch;
  }
  return null;
}

/**
 * Create a rule with the next free letter. Returns the new row's id + letter so
 * the caller can select it; does not redirect (the page is a two-pane SPA-ish
 * workspace).
 */
export async function createRule(): Promise<{ id: string; letter: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("sorting_rules").select("letter");
  const letter = nextFreeLetter(new Set((existing ?? []).map((r) => r.letter)));
  if (!letter) throw new Error("No free rule letter (A-Z) available.");
  const { data, error } = await supabase
    .from("sorting_rules")
    .insert({ letter, match_mode: "all" as RuleMatchMode })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/sorting/rules");
  return { id: data!.id, letter };
}

/** Clone a rule (scalar fields + every condition) under the next free letter. */
export async function duplicateRule(
  formData: FormData
): Promise<{ id: string } | void> {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { data: source } = await supabase
    .from("sorting_rules")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!source) return;

  const { data: existing } = await supabase.from("sorting_rules").select("letter");
  const letter = nextFreeLetter(new Set((existing ?? []).map((r) => r.letter)));
  if (!letter) throw new Error("No free rule letter (A-Z) available.");

  const { data: inserted, error } = await supabase
    .from("sorting_rules")
    .insert({
      letter,
      storage_location: source.storage_location,
      summary: source.summary,
      day_implemented_id: source.day_implemented_id,
      day_cancelled_id: source.day_cancelled_id,
      destination_slot: source.destination_slot,
      routes_to_reporting: source.routes_to_reporting,
      match_mode: source.match_mode,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { data: conditions } = await supabase
    .from("sorting_rule_conditions")
    .select("*")
    .eq("rule_id", id)
    .order("position");
  if (conditions && conditions.length > 0) {
    const { error: cErr } = await supabase.from("sorting_rule_conditions").insert(
      conditions.map((c) => ({
        rule_id: inserted!.id,
        position: c.position,
        target: c.target,
        target_slice: c.target_slice,
        operator: c.operator,
        reference_value: c.reference_value,
        reference_type: c.reference_type,
      }))
    );
    if (cErr) throw new Error(cErr.message);
  }

  revalidatePath("/sorting/rules");
  return { id: inserted!.id };
}

/** Delete a rule (conditions cascade). Revalidates rather than redirecting so
 *  the workspace's realtime channel survives; the caller closes the panel. */
export async function deleteRule(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  if (updatedBy) {
    await supabase
      .from("sorting_rules")
      .update({ updated_by: updatedBy })
      .eq("id", id);
  }
  const { error } = await supabase.from("sorting_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/sorting/rules");
}

/**
 * Narrow per-field patch for instant-save. Does NOT call revalidatePath —
 * realtime fans out the change to all subscribed clients. A unique-violation
 * on `letter` is surfaced as a friendly message so the field can revert.
 */
export async function patchSortingRule(
  id: string,
  patch: Partial<{
    letter: string;
    storage_location: string | null;
    summary: string | null;
    day_implemented_id: string | null;
    day_cancelled_id: string | null;
    destination_slot: number | null;
    routes_to_reporting: boolean;
    match_mode: RuleMatchMode;
  }>
) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sorting_rules")
    .update(patch)
    .eq("id", id);
  if (error) {
    if (/unique/i.test(error.message)) {
      throw new Error("That Rule ID is already in use.");
    }
    throw new Error(error.message);
  }
}

/**
 * Replace all conditions for a rule in one shot (structural mutation).
 * Keeps revalidatePath so peer INSERTs/DELETEs on conditions trigger a
 * UI refresh. Conditions are always re-written as a set, not patched
 * individually.
 */
export async function saveConditions(
  ruleId: string,
  conditions: Array<{
    position: number;
    target: RuleTarget;
    target_slice: RuleTargetSlice;
    operator: RuleOperator;
    reference_type: RuleReferenceType;
    reference_value: string | null;
  }>,
  matchMode?: RuleMatchMode
) {
  const supabase = await createSupabaseServerClient();
  const { error: delErr } = await supabase
    .from("sorting_rule_conditions")
    .delete()
    .eq("rule_id", ruleId);
  if (delErr) throw new Error(delErr.message);
  if (conditions.length > 0) {
    const { error } = await supabase.from("sorting_rule_conditions").insert(
      conditions.map((c) => {
        if (
          (c.target === "sender_citizen_id" || c.target === "recipient_citizen_id") &&
          c.target_slice === "whole"
        ) {
          c = { ...c, reference_value: toStorageCitizenId(c.reference_value) };
        }
        return { rule_id: ruleId, ...c };
      })
    );
    if (error) throw new Error(error.message);
  }
  if (matchMode) {
    const { error } = await supabase
      .from("sorting_rules")
      .update({ match_mode: matchMode })
      .eq("id", ruleId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/sorting/rules");
}
