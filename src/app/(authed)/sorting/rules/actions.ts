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
  const { data: existing } = await supabase
    .from("sorting_rules")
    .select("letter, sort_order");
  const letter = nextFreeLetter(new Set((existing ?? []).map((r) => r.letter)));
  if (!letter) throw new Error("No free rule letter (A-Z) available.");
  // Append to the bottom of the manual order.
  const maxOrder = (existing ?? []).reduce(
    (m, r) => Math.max(m, (r.sort_order as number) ?? 0),
    -1
  );
  const { data, error } = await supabase
    .from("sorting_rules")
    .insert({
      letter,
      match_mode: "all" as RuleMatchMode,
      sort_order: maxOrder + 1,
    })
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

  const { data: existing } = await supabase
    .from("sorting_rules")
    .select("letter, sort_order");
  const letter = nextFreeLetter(new Set((existing ?? []).map((r) => r.letter)));
  if (!letter) throw new Error("No free rule letter (A-Z) available.");
  const maxOrder = (existing ?? []).reduce(
    (m, r) => Math.max(m, (r.sort_order as number) ?? 0),
    -1
  );

  const { data: inserted, error } = await supabase
    .from("sorting_rules")
    .insert({
      letter,
      storage_location: source.storage_location,
      summary: source.summary,
      notes: source.notes,
      color_hex: source.color_hex,
      day_implemented_id: source.day_implemented_id,
      day_cancelled_id: source.day_cancelled_id,
      destination_slot: source.destination_slot,
      routes_to_reporting: source.routes_to_reporting,
      match_mode: source.match_mode,
      sort_order: maxOrder + 1,
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
    notes: string | null;
    color_hex: string | null;
    day_implemented_id: string | null;
    day_cancelled_id: string | null;
    destination_slot: number | null;
    routes_to_reporting: boolean;
    match_mode: RuleMatchMode;
  }>
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { error } = await supabase
    .from("sorting_rules")
    .update({ ...patch, ...(updatedBy ? { updated_by: updatedBy } : {}) })
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
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
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
  // Always stamp the parent rule so the "Last updated" footer reflects
  // condition-only edits too. Combine with match_mode when provided.
  const parentPatch: Record<string, unknown> = {};
  if (matchMode) parentPatch.match_mode = matchMode;
  if (updatedBy) parentPatch.updated_by = updatedBy;
  if (Object.keys(parentPatch).length > 0) {
    const { error } = await supabase
      .from("sorting_rules")
      .update(parentPatch)
      .eq("id", ruleId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/sorting/rules");
}

/**
 * Persist a new manual ordering of rules in a single round-trip via the
 * `reorder_sorting_rules` RPC. Drag-and-drop and "Sort by ID" both feed
 * this. Skips `revalidatePath` — the realtime channel fans the UPDATEs out
 * to peers and the client mirror reconciles them against its optimistic
 * order.
 */
export async function reorderRules(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const updates = orderedIds.map((id, i) => ({ id, sort_order: i }));
  const { error } = await supabase.rpc("reorder_sorting_rules", {
    updates,
    updated_by_email: updatedBy,
  });
  if (error) throw new Error(error.message);
}

/** Re-order rules alphabetically by letter without changing any letters. */
export async function sortRulesByLetter(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("sorting_rules")
    .select("id, letter")
    .order("letter");
  const ids = (data ?? []).map((r) => r.id as string);
  await reorderRules(ids);
}

/**
 * Apply a permutation of rule letters via the `apply_rule_letters` RPC.
 * One transactional UPDATE on the server — Postgres only enforces
 * unique(letter) at statement end, so any valid permutation works without
 * cycle-breaking. Atomic: either every row's letter changes or none do.
 */
async function applyLetterPermutation(
  assignments: Array<{ id: string; letter: string }>
): Promise<void> {
  if (assignments.length === 0) return;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { error } = await supabase.rpc("apply_rule_letters", {
    updates: assignments.map((a) => ({
      id: a.id,
      letter: a.letter.toUpperCase(),
    })),
    updated_by_email: updatedBy,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/sorting/rules");
}

/** Public: apply edits from the Edit-ID renumber dialog (one or more
 *  rule letter reassignments, cascade-aware). */
export async function applyRuleLetters(
  assignments: Array<{ id: string; letter: string }>
): Promise<void> {
  await applyLetterPermutation(assignments);
}

/**
 * Renumber rule letters based on the current `sort_order` — rule at position
 * 0 becomes A, position 1 becomes B, etc.
 */
export async function renumberRuleLetters(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("sorting_rules")
    .select("id, sort_order")
    .order("sort_order")
    .order("letter");
  const rows = (data ?? []) as Array<{ id: string; sort_order: number }>;
  if (rows.length > 26) {
    throw new Error("Too many rules to renumber (max 26).");
  }
  const assignments = rows.map((r, i) => ({
    id: r.id,
    letter: String.fromCharCode(65 + i),
  }));
  await applyLetterPermutation(assignments);
}
