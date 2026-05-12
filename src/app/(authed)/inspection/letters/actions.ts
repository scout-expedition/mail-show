"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CitizenType, IconType } from "@/lib/db/enums";
import type { LetterGroup } from "@/lib/db/types";

/**
 * Reassign variants for every letter in a group based on current sort_order.
 * Always 'a', 'b', 'c' ... — the view hides the "/a" suffix when the group
 * has only one letter, so the display stays clean while the underlying
 * variant is stable for action references.
 */
async function reassignVariants(groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("inspection_letters")
    .select("id, sort_order")
    .eq("letter_group_id", groupId)
    .order("sort_order");
  const list = rows ?? [];
  if (list.length === 0) return;
  for (let i = 0; i < list.length; i++) {
    const variant = String.fromCharCode(97 + i);
    await supabase
      .from("inspection_letters")
      .update({ variant })
      .eq("id", list[i].id as string);
  }
}

type LetterPatch = {
  id: string;
  piece: number | null;
  delivery_day_override_id: string | null;
  summary: string | null;
  content: string | null;
  sender_citizen_id: string | null;
  receiver_citizen_id: string | null;
  notes: string | null;
};

type EndingAssignmentPatch = { variable_id: string; value_id: string };

type ActionPatch = {
  id: string;
  report_segment_id: string | null;
  next_letter_variant: string | null;
  impact_world_status: number;
  impact_demerits: number;
  impact_proletariat: number;
  impact_gentry: number;
  impact_epicenter: number;
  impact_folos: number;
  impact_emberlyn: number;
  impact_spokgrad: number;
  impact_pelico: number;
  ending_assignments: EndingAssignmentPatch[];
};

/**
 * Replace an action's ending-variable assignments wholesale. The caller
 * passes the full desired set; we delete whatever's there and reinsert.
 * De-dupes by variable_id so we never violate the (action_id, variable_id)
 * unique constraint even if the client sends two rows for the same variable.
 */
async function replaceEndingAssignments(
  actionId: string,
  assignments: EndingAssignmentPatch[]
) {
  const supabase = await createSupabaseServerClient();
  const { error: delErr } = await supabase
    .from("inspection_action_ending_assignments")
    .delete()
    .eq("action_id", actionId);
  if (delErr) throw new Error(delErr.message);
  const seen = new Set<string>();
  const rows: Array<{
    action_id: string;
    variable_id: string;
    value_id: string;
  }> = [];
  for (const a of assignments) {
    if (!a.variable_id || !a.value_id) continue;
    if (seen.has(a.variable_id)) continue;
    seen.add(a.variable_id);
    rows.push({
      action_id: actionId,
      variable_id: a.variable_id,
      value_id: a.value_id,
    });
  }
  if (rows.length > 0) {
    const { error } = await supabase
      .from("inspection_action_ending_assignments")
      .insert(rows);
    if (error) throw new Error(error.message);
  }
}

export async function saveGroup(data: {
  id: string;
  storyline_id: string;
  name: string;
  notes: string | null;
  delivery_day_id: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const { id, ...rest } = data;
  const { error } = await supabase
    .from("letter_groups")
    .update(rest)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await supabase
    .from("report_groups")
    .update({ name: rest.name })
    .eq("letter_group_id", id);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Lightweight move used by the narrative graph drag-and-drop. Updates
 * only `delivery_day_id` without touching name/notes (those are owned by
 * the inspector panel). `sequence` is unique per storyline, not per day,
 * so day changes don't require any re-sequencing.
 */
export async function moveLetterGroupToDay(
  groupId: string,
  dayId: string | null
) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("letter_groups")
    .update({ delivery_day_id: dayId })
    .eq("id", groupId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/** Move a report segment's delivery-day override. */
export async function moveReportSegmentToDay(
  segmentId: string,
  dayId: string | null
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { error } = await supabase
    .from("report_segments")
    .update({ delivery_day_override_id: dayId, updated_by: updatedBy })
    .eq("id", segmentId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Move an inspection letter to a different group within the same
 * storyline. Re-slots variants in both groups, renumbers pieces in the
 * old group, and nulls any `actions.next_letter_variant` refs on the
 * old group's letters that pointed at the moved letter's previous
 * variant (which is about to be reassigned). Rejects cross-storyline
 * moves.
 */
export async function moveLetterToGroup(
  letterId: string,
  targetGroupId: string
) {
  const supabase = await createSupabaseServerClient();

  // Resolve the source letter + groups.
  const { data: letterRow, error: lErr } = await supabase
    .from("inspection_letters")
    .select("id, letter_group_id, variant")
    .eq("id", letterId)
    .single();
  if (lErr || !letterRow) throw new Error(lErr?.message ?? "letter not found");
  const sourceGroupId = letterRow.letter_group_id as string;
  const oldVariant = (letterRow.variant as string | null) ?? null;
  if (sourceGroupId === targetGroupId) return;

  const { data: groups, error: gErr } = await supabase
    .from("letter_groups")
    .select("id, storyline_id")
    .in("id", [sourceGroupId, targetGroupId]);
  if (gErr) throw new Error(gErr.message);
  const sourceGroup = groups?.find((g) => g.id === sourceGroupId);
  const targetGroup = groups?.find((g) => g.id === targetGroupId);
  if (!sourceGroup || !targetGroup) throw new Error("group not found");
  if (sourceGroup.storyline_id !== targetGroup.storyline_id) {
    throw new Error("cross-storyline letter move is not supported");
  }

  // Append into target group with a fresh sort_order slot.
  const { data: targetLetters } = await supabase
    .from("inspection_letters")
    .select("sort_order")
    .eq("letter_group_id", targetGroupId);
  const nextSortOrder =
    Math.max(0, ...((targetLetters ?? []).map((l) => l.sort_order ?? 0))) + 1;

  // Null the variant in the same UPDATE so the move never collides with
  // the (letter_group_id, variant) unique constraint when the target group
  // already has a letter at the moved letter's old variant. reassignVariants
  // below repopulates a fresh slot from sort_order. Without this, dragging
  // a letter back to a group it once lived in fails the constraint and the
  // drop silently no-ops on revalidation.
  const { error: mErr } = await supabase
    .from("inspection_letters")
    .update({
      letter_group_id: targetGroupId,
      sort_order: nextSortOrder,
      variant: null,
    })
    .eq("id", letterId);
  if (mErr) throw new Error(mErr.message);

  // Null out any next_letter_variant on the source group's letters that
  // pointed at the old variant (those refs are no longer valid since the
  // letter left the group and variants will re-slot).
  if (oldVariant) {
    const { data: sourceLetters } = await supabase
      .from("inspection_letters")
      .select("id")
      .eq("letter_group_id", sourceGroupId);
    const sourceLetterIds = (sourceLetters ?? []).map((l) => l.id as string);
    if (sourceLetterIds.length > 0) {
      await supabase
        .from("actions")
        .update({ next_letter_variant: null })
        .in("inspection_letter_id", sourceLetterIds)
        .eq("next_letter_variant", oldVariant);
    }
  }

  // Re-slot variants in both groups (lowercase a, b, c, … by sort_order).
  await reassignVariants(sourceGroupId);
  await reassignVariants(targetGroupId);
  // Renumber pieces for the old variant in the source group (in case
  // multiple pieces shared that variant).
  if (oldVariant) {
    await reassignPiecesForVariant(sourceGroupId, oldVariant);
  }

  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Set or clear an action's next-letter link by the target letter id. Used
 * by the narrative graph's edge-reconnect drag.
 *
 * - Passing `null` clears the link (the action's arrow becomes dangling).
 * - Passing a `letterId` validates the target sits in the next adjacent
 *   group of the source action's storyline (same storyline_id, sequence +
 *   1). Promotes the target letter's variant from null → 'a' if needed so
 *   `next_letter_variant` always points at a stable, non-null variant.
 *
 * Invalid links (cross-storyline, non-adjacent, missing rows) are silently
 * ignored — the graph snaps back on revalidation.
 */
export async function setActionNextLetterByLetterId(
  actionId: string,
  letterId: string | null
) {
  const supabase = await createSupabaseServerClient();
  if (letterId === null) {
    const { error } = await supabase
      .from("actions")
      .update({ next_letter_variant: null })
      .eq("id", actionId);
    if (error) throw new Error(error.message);
    revalidatePath("/inspection/letters");
    revalidatePath("/graph");
    return;
  }
  const { data: act } = await supabase
    .from("actions")
    .select("inspection_letter_id")
    .eq("id", actionId)
    .maybeSingle();
  if (!act) return;
  const { data: srcLetter } = await supabase
    .from("inspection_letters")
    .select("letter_group_id")
    .eq("id", act.inspection_letter_id as string)
    .maybeSingle();
  const { data: tgtLetter } = await supabase
    .from("inspection_letters")
    .select("letter_group_id, variant")
    .eq("id", letterId)
    .maybeSingle();
  if (!srcLetter || !tgtLetter) return;
  const sourceGroupId = srcLetter.letter_group_id as string;
  const targetGroupId = tgtLetter.letter_group_id as string;
  const { data: groups } = await supabase
    .from("letter_groups")
    .select("id, storyline_id, sequence")
    .in("id", [sourceGroupId, targetGroupId]);
  const srcGroup = groups?.find((g) => g.id === sourceGroupId);
  const tgtGroup = groups?.find((g) => g.id === targetGroupId);
  if (!srcGroup || !tgtGroup) return;
  if (srcGroup.storyline_id !== tgtGroup.storyline_id) return;
  if (Number(tgtGroup.sequence) !== Number(srcGroup.sequence) + 1) return;
  let variant = (tgtLetter.variant as string | null) ?? null;
  if (!variant) {
    variant = await ensureLetterVariant(letterId);
  }
  const { error } = await supabase
    .from("actions")
    .update({ next_letter_variant: variant })
    .eq("id", actionId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Set or clear an action's report-segment link by segment id. Used by the
 * narrative graph's drag-to-attach handle. Validates the target segment
 * belongs to the report group of the action's source letter; otherwise
 * silently no-ops so cross-group drops snap back on revalidation.
 */
export async function setActionReportSegment(
  actionId: string,
  reportSegmentId: string | null
) {
  const supabase = await createSupabaseServerClient();
  if (reportSegmentId === null) {
    const { error } = await supabase
      .from("actions")
      .update({ report_segment_id: null })
      .eq("id", actionId);
    if (error) throw new Error(error.message);
    revalidatePath("/inspection/letters");
    revalidatePath("/graph");
    return;
  }
  const { data: act } = await supabase
    .from("actions")
    .select("inspection_letter_id")
    .eq("id", actionId)
    .maybeSingle();
  if (!act) return;
  const { data: srcLetter } = await supabase
    .from("inspection_letters")
    .select("letter_group_id")
    .eq("id", act.inspection_letter_id as string)
    .maybeSingle();
  if (!srcLetter) return;
  const { data: rg } = await supabase
    .from("report_groups")
    .select("id")
    .eq("letter_group_id", srcLetter.letter_group_id as string)
    .maybeSingle();
  if (!rg) return;
  const { data: seg } = await supabase
    .from("report_segments")
    .select("report_group_id")
    .eq("id", reportSegmentId)
    .maybeSingle();
  if (!seg) return;
  if (seg.report_group_id !== rg.id) return;
  const { error } = await supabase
    .from("actions")
    .update({ report_segment_id: reportSegmentId })
    .eq("id", actionId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Batch apply a mix of day-moves in a single server roundtrip so the
 * graph only revalidates once. Used by rubber-band multi-select.
 */
export async function batchMoveToDay(
  moves: Array<
    | { kind: "group"; id: string; targetDayId: string | null }
    | { kind: "report"; id: string; targetDayId: string | null }
  >
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  for (const m of moves) {
    if (m.kind === "group") {
      const { error } = await supabase
        .from("letter_groups")
        .update({ delivery_day_id: m.targetDayId })
        .eq("id", m.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("report_segments")
        .update({
          delivery_day_override_id: m.targetDayId,
          updated_by: updatedBy,
        })
        .eq("id", m.id);
      if (error) throw new Error(error.message);
    }
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

export async function deleteGroup(groupId: string) {
  const supabase = await createSupabaseServerClient();
  // Capture the previous group in this storyline so we can clear stale
  // next_letter_variant refs that pointed into the now-deleted group.
  const { data: thisGroup } = await supabase
    .from("letter_groups")
    .select("storyline_id, sequence")
    .eq("id", groupId)
    .maybeSingle();
  let prevLetterIds: string[] = [];
  if (thisGroup) {
    const { data: prev } = await supabase
      .from("letter_groups")
      .select("id")
      .eq("storyline_id", thisGroup.storyline_id)
      .lt("sequence", thisGroup.sequence)
      .order("sequence", { ascending: false })
      .limit(1);
    const prevGroupId = prev?.[0]?.id as string | undefined;
    if (prevGroupId) {
      const { data: prevLetters } = await supabase
        .from("inspection_letters")
        .select("id")
        .eq("letter_group_id", prevGroupId);
      prevLetterIds = (prevLetters ?? []).map((r) => r.id as string);
    }
  }
  // FK cascade handles report_groups, report_segments, inspection_letters,
  // and (transitively) actions tied to this group's letters.
  const { error } = await supabase
    .from("letter_groups")
    .delete()
    .eq("id", groupId);
  if (error) throw new Error(error.message);
  // Clear actions in the previous group whose next_letter_variant pointed
  // into the now-deleted group.
  if (prevLetterIds.length > 0) {
    await supabase
      .from("actions")
      .update({ next_letter_variant: null })
      .in("inspection_letter_id", prevLetterIds)
      .not("next_letter_variant", "is", null);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  redirect("/inspection/letters");
}

export async function createInspectionLetterInGroup(groupId: string) {
  const ids = await createInspectionLettersInGroup(groupId, 1);
  return ids[0];
}

/**
 * Create 1..3 letters in a group. When count > 1, variants are assigned the
 * next available lowercase letters (a-z) that are not already used in the
 * group; the first created letter gets the first free letter, etc.
 */
export async function createInspectionLettersInGroup(
  groupId: string,
  count: number
) {
  const supabase = await createSupabaseServerClient();
  const n = Math.max(1, Math.min(3, count));
  const { data: existing } = await supabase
    .from("inspection_letters")
    .select("sort_order")
    .eq("letter_group_id", groupId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextStart = (existing?.[0]?.sort_order ?? 0) + 1;
  const toInsert = Array.from({ length: n }, (_, i) => ({
    letter_group_id: groupId,
    sort_order: nextStart + i,
  }));
  const { data, error } = await supabase
    .from("inspection_letters")
    .insert(toInsert)
    .select("id");
  if (error) throw new Error(error.message);
  await reassignVariants(groupId);
  revalidatePath("/inspection/letters");
  return (data ?? []).map((r) => r.id as string);
}

export async function deleteInspectionLetter(groupId: string, letterId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: deleted } = await supabase
    .from("inspection_letters")
    .select("variant")
    .eq("id", letterId)
    .maybeSingle();
  const deletedVariant = (deleted?.variant ?? null) as string | null;
  // FK cascade on actions.inspection_letter_id removes this letter's own
  // actions automatically.
  const { error } = await supabase
    .from("inspection_letters")
    .delete()
    .eq("id", letterId);
  if (error) throw new Error(error.message);
  await reassignVariants(groupId);
  if (deletedVariant) await reassignPiecesForVariant(groupId, deletedVariant);
  // Clear orphaned next_letter_variant refs in the previous group: any
  // action whose target variant key no longer exists in this group after
  // the delete + reassign.
  const { data: thisGroup } = await supabase
    .from("letter_groups")
    .select("storyline_id, sequence")
    .eq("id", groupId)
    .maybeSingle();
  if (thisGroup) {
    const { data: prev } = await supabase
      .from("letter_groups")
      .select("id")
      .eq("storyline_id", thisGroup.storyline_id)
      .lt("sequence", thisGroup.sequence)
      .order("sequence", { ascending: false })
      .limit(1);
    const prevGroupId = prev?.[0]?.id as string | undefined;
    if (prevGroupId) {
      const { data: prevLetterRows } = await supabase
        .from("inspection_letters")
        .select("id")
        .eq("letter_group_id", prevGroupId);
      const prevLetterIds = (prevLetterRows ?? []).map((r) => r.id as string);
      if (prevLetterIds.length > 0) {
        const { data: currentLetters } = await supabase
          .from("inspection_letters")
          .select("variant")
          .eq("letter_group_id", groupId);
        const validVariants = new Set(
          (currentLetters ?? [])
            .map((r) => r.variant as string | null)
            .filter((v): v is string => !!v)
        );
        const { data: stale } = await supabase
          .from("actions")
          .select("id, next_letter_variant")
          .in("inspection_letter_id", prevLetterIds)
          .not("next_letter_variant", "is", null);
        const orphanIds = (stale ?? [])
          .filter(
            (a) =>
              a.next_letter_variant &&
              !validVariants.has(a.next_letter_variant as string)
          )
          .map((a) => a.id as string);
        if (orphanIds.length > 0) {
          await supabase
            .from("actions")
            .update({ next_letter_variant: null })
            .in("id", orphanIds);
        }
      }
    }
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Renumber pieces for all letters in (groupId, variant). If only one letter
 * remains in that variant cluster, clear its piece. Otherwise assign 1..N by
 * sort_order.
 */
async function reassignPiecesForVariant(groupId: string, variant: string) {
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("inspection_letters")
    .select("id, sort_order")
    .eq("letter_group_id", groupId)
    .eq("variant", variant)
    .order("sort_order");
  const list = rows ?? [];
  if (list.length === 0) return;
  if (list.length === 1) {
    await supabase
      .from("inspection_letters")
      .update({ piece: null })
      .eq("id", list[0].id as string);
    return;
  }
  for (let i = 0; i < list.length; i++) {
    await supabase
      .from("inspection_letters")
      .update({ piece: i + 1 })
      .eq("id", list[i].id as string);
  }
}

/**
 * Add a new "piece" to an existing letter: both the source letter and the
 * new letter share the same variant and are numbered consecutively. If the
 * source letter had no variant yet, a variant is assigned so pieces can be
 * referenced. Returns the new letter's id.
 */
export async function addPieceToLetter(
  groupId: string,
  letterId: string
): Promise<{ newLetterId: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from("inspection_letters")
    .select("id, variant, sort_order")
    .eq("id", letterId)
    .maybeSingle();
  if (!current) throw new Error("Letter not found");
  let variant = (current.variant ?? null) as string | null;

  // Ensure the source letter has a variant — otherwise we can't group pieces.
  if (!variant) {
    // Find an unused single-letter variant in this group.
    const { data: siblings } = await supabase
      .from("inspection_letters")
      .select("variant")
      .eq("letter_group_id", groupId);
    const used = new Set(
      (siblings ?? [])
        .map((s) => (s.variant ?? null) as string | null)
        .filter((v): v is string => typeof v === "string")
    );
    variant = "a";
    for (let c = 97; c <= 122; c++) {
      const v = String.fromCharCode(c);
      if (!used.has(v)) {
        variant = v;
        break;
      }
    }
    await supabase
      .from("inspection_letters")
      .update({ variant })
      .eq("id", letterId);
  }

  // Push any existing letter at higher sort_order down by 1 to make room.
  const currentSort = Number(current.sort_order ?? 0);
  const { data: below } = await supabase
    .from("inspection_letters")
    .select("id, sort_order")
    .eq("letter_group_id", groupId)
    .gt("sort_order", currentSort)
    .order("sort_order");
  for (const row of below ?? []) {
    await supabase
      .from("inspection_letters")
      .update({ sort_order: Number(row.sort_order) + 1 })
      .eq("id", row.id as string);
  }

  const { data: inserted, error } = await supabase
    .from("inspection_letters")
    .insert({
      letter_group_id: groupId,
      variant,
      sort_order: currentSort + 1,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const newLetterId = inserted!.id as string;

  await reassignPiecesForVariant(groupId, variant);
  revalidatePath("/inspection/letters");
  return { newLetterId };
}

/** Reorder letters by passing the new order of letter ids. */
export async function reorderInspectionLetters(
  groupId: string,
  orderedIds: string[]
) {
  const supabase = await createSupabaseServerClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("inspection_letters")
      .update({ sort_order: i + 1 })
      .eq("id", orderedIds[i]);
    if (error) throw new Error(error.message);
  }
  await reassignVariants(groupId);
  revalidatePath("/inspection/letters");
  revalidatePath("/inspection/letters");
}

/**
 * Reorder report segments within a report group, then reassign Roman-numeral
 * variants by new sort order so display IDs (R-W2/i, R-W2/ii…) line up with
 * the user-chosen sequence. Segment IDs are stable, so action references
 * (`report_segment_id`) are unaffected.
 */
export async function reorderReportSegments(orderedIds: string[]) {
  const supabase = await createSupabaseServerClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const variant = toRoman(i + 1);
    const { error } = await supabase
      .from("report_segments")
      .update({ sort_order: i + 1, variant })
      .eq("id", orderedIds[i]);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/** Reorder letter groups within a storyline by passing the new order of group ids. */
export async function reorderLetterGroups(
  storylineId: string,
  orderedIds: string[]
) {
  const supabase = await createSupabaseServerClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("letter_groups")
      .update({ sequence: i + 1 })
      .eq("id", orderedIds[i])
      .eq("storyline_id", storylineId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath(`/inspection/storylines/${storylineId}`);
}

// ---------------------------------------------------------------------------
// Narrow patch actions
//
// Used by the realtime instant-save layer: each one updates a partial set of
// columns on a single row and intentionally does NOT call revalidatePath —
// Supabase Realtime postgres_changes fan-out is what propagates the update
// to other clients. Structural mutations above keep their revalidatePath.
// ---------------------------------------------------------------------------

type InspectionLetterPatchFields = {
  piece: number | null;
  delivery_day_override_id: string | null;
  summary: string | null;
  content: string | null;
  sender_citizen_id: string | null;
  receiver_citizen_id: string | null;
  notes: string | null;
};

export async function patchInspectionLetter(
  id: string,
  patch: Partial<InspectionLetterPatchFields>
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { error } = await supabase
    .from("inspection_letters")
    .update({ ...patch, updated_by: updatedBy })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

type LetterGroupPatchFields = {
  storyline_id: string;
  name: string;
  notes: string | null;
  delivery_day_id: string | null;
};

export async function patchLetterGroup(
  id: string,
  patch: Partial<LetterGroupPatchFields>
) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("letter_groups")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
  // letter_groups.name is mirrored to its report_group (matches saveGroup).
  if (patch.name !== undefined) {
    await supabase
      .from("report_groups")
      .update({ name: patch.name })
      .eq("letter_group_id", id);
  }
}

type ActionPatchFields = {
  report_segment_id: string | null;
  next_letter_variant: string | null;
  impact_world_status: number;
  impact_demerits: number;
  impact_proletariat: number;
  impact_gentry: number;
  impact_epicenter: number;
  impact_folos: number;
  impact_emberlyn: number;
  impact_spokgrad: number;
  impact_pelico: number;
};

export async function patchAction(
  id: string,
  patch: Partial<ActionPatchFields>
) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("actions").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Replace an action's ending-variable assignments. Multi-row mutation
 * (delete-then-insert in `inspection_action_ending_assignments`), so this
 * sits alongside the per-column `patchAction` rather than inside it. No
 * `revalidatePath` — caller relies on realtime to fan out.
 */
export async function patchActionEndingAssignments(
  actionId: string,
  assignments: EndingAssignmentPatch[]
) {
  await replaceEndingAssignments(actionId, assignments);
}

type ReportSegmentPatchFields = {
  variant: string;
  summary: string | null;
  content: string | null;
  delivery_day_override_id: string | null;
};

export async function patchReportSegment(
  id: string,
  patch: Partial<ReportSegmentPatchFields>
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { error } = await supabase
    .from("report_segments")
    .update({ ...patch, updated_by: updatedBy })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function saveLetterWithActions(
  groupId: string,
  letter: LetterPatch,
  actions: ActionPatch[]
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { id: letterId, ...letterRest } = letter;
  const { error: lErr } = await supabase
    .from("inspection_letters")
    .update({ ...letterRest, updated_by: updatedBy })
    .eq("id", letterId);
  if (lErr) throw new Error(lErr.message);
  for (const a of actions) {
    const { id: actionId, ending_assignments, ...rest } = a;
    const { error } = await supabase
      .from("actions")
      .update(rest)
      .eq("id", actionId);
    if (error) throw new Error(error.message);
    await replaceEndingAssignments(actionId, ending_assignments);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/endings/frameworks");
  revalidatePath("/graph");
}

/** Save just the inspection letter row — no actions touched. */
export async function saveLetterFields(letter: LetterPatch) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { id: letterId, ...rest } = letter;
  const { error } = await supabase
    .from("inspection_letters")
    .update({ ...rest, updated_by: updatedBy })
    .eq("id", letterId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/** Save only the action rows for a letter — letter row not touched. */
export async function saveLetterActionsOnly(actions: ActionPatch[]) {
  const supabase = await createSupabaseServerClient();
  for (const a of actions) {
    const { id: actionId, ending_assignments, ...rest } = a;
    const { error } = await supabase
      .from("actions")
      .update(rest)
      .eq("id", actionId);
    if (error) throw new Error(error.message);
    await replaceEndingAssignments(actionId, ending_assignments);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/endings/frameworks");
  revalidatePath("/graph");
}

export async function addActionFromTemplate(
  groupId: string,
  letterId: string,
  templateId: string
) {
  const supabase = await createSupabaseServerClient();
  const { data: tpl, error: tErr } = await supabase
    .from("action_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!tpl) throw new Error("Template not found");

  const templatesToInsert: Array<{ id: string; tpl: typeof tpl }> = [
    { id: tpl.id, tpl },
  ];
  if (tpl.paired_template_id) {
    const { data: partner } = await supabase
      .from("action_templates")
      .select("*")
      .eq("id", tpl.paired_template_id)
      .maybeSingle();
    if (partner) templatesToInsert.push({ id: partner.id, tpl: partner });
  }

  const { data: existing } = await supabase
    .from("actions")
    .select("sort_order")
    .eq("inspection_letter_id", letterId)
    .order("sort_order", { ascending: false })
    .limit(1);
  let nextSort = (existing?.[0]?.sort_order ?? -1) + 1;

  const rows = templatesToInsert.map(({ tpl: t }) => ({
    inspection_letter_id: letterId,
    action_template_id: t.id,
    name: t.name,
    icon_type: t.icon_type as IconType,
    icon_value: t.icon_value,
    color_hex: t.color_hex,
    sort_order: nextSort++,
  }));
  const { error } = await supabase.from("actions").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
}

export async function deleteActionRow(groupId: string, actionId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("actions").delete().eq("id", actionId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
}

/** Ensure the given letter has a non-null variant so it can be referenced. */
async function ensureLetterVariant(letterId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("inspection_letters")
    .select("variant")
    .eq("id", letterId)
    .maybeSingle();
  const existing = (row?.variant ?? null) as string | null;
  if (existing) return existing;
  await supabase
    .from("inspection_letters")
    .update({ variant: "a" })
    .eq("id", letterId);
  return "a";
}

/**
 * Public wrapper: promote a letter's variant from null to 'a' if needed, so
 * actions can reference it by `next_letter_variant`. Single-letter groups
 * keep a null variant for display, but picking them as a "next letter"
 * requires a stable variant to point at.
 */
export async function ensureInspectionLetterVariant(
  letterId: string
): Promise<{ variant: string }> {
  const variant = await ensureLetterVariant(letterId);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  return { variant };
}

/**
 * Create a new letter in the "next" letter group (by sequence) in the same
 * storyline. Returns the new letter's variant so the caller can set it as
 * `next_letter_variant` on the current action.
 */
export async function createLetterInNextGroup(
  currentGroupId: string
): Promise<{ letterId: string; variant: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: cur } = await supabase
    .from("letter_groups")
    .select("id, storyline_id, sequence")
    .eq("id", currentGroupId)
    .maybeSingle();
  if (!cur) throw new Error("Current letter group not found");
  const { data: next } = await supabase
    .from("letter_groups")
    .select("id")
    .eq("storyline_id", cur.storyline_id)
    .gt("sequence", cur.sequence)
    .order("sequence")
    .limit(1);
  const nextGroupId = next?.[0]?.id as string | undefined;
  if (!nextGroupId) throw new Error("No next letter group exists");
  const ids = await createInspectionLettersInGroup(nextGroupId, 1);
  const letterId = ids[0];
  const variant = await ensureLetterVariant(letterId);
  revalidatePath("/inspection/letters");
  return { letterId, variant };
}

/**
 * Create the next letter group (auto sequence) and a first letter in it.
 * Returns the new letter's variant for the action linkage.
 */
export async function createNextLetterGroupAndLetter(
  currentGroupId: string
): Promise<{ newGroupId: string; letterId: string; variant: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: cur } = await supabase
    .from("letter_groups")
    .select("id, storyline_id, sequence")
    .eq("id", currentGroupId)
    .maybeSingle();
  if (!cur) throw new Error("Current letter group not found");
  const { data: existing } = await supabase
    .from("letter_groups")
    .select("sequence")
    .eq("storyline_id", cur.storyline_id)
    .order("sequence", { ascending: false })
    .limit(1);
  const nextSeq = (existing?.[0]?.sequence ?? 0) + 1;
  const { data: newGroup, error } = await supabase
    .from("letter_groups")
    .insert({
      storyline_id: cur.storyline_id,
      name: `Group ${nextSeq}`,
      sequence: nextSeq,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const newGroupId = newGroup!.id as string;
  const ids = await createInspectionLettersInGroup(newGroupId, 1);
  const letterId = ids[0];
  const variant = await ensureLetterVariant(letterId);
  revalidatePath("/inspection/letters");
  revalidatePath("/inspection/letters");
  return { newGroupId, letterId, variant };
}

/**
 * Non-redirecting variant of storylines/actions.ts::createLetterGroup, for
 * the inline StorylineInspector — returns the new group's id so the caller
 * can select it client-side instead of navigating.
 */
export async function createLetterGroupInStoryline(
  storylineId: string
): Promise<{ group: LetterGroup }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("letter_groups")
    .select("sequence")
    .eq("storyline_id", storylineId)
    .order("sequence", { ascending: false })
    .limit(1);
  const nextSeq = (existing?.[0]?.sequence ?? 0) + 1;
  const { data, error } = await supabase
    .from("letter_groups")
    .insert({
      storyline_id: storylineId,
      name: `Group ${nextSeq}`,
      sequence: nextSeq,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath(`/inspection/storylines/${storylineId}`);
  return { group: data as LetterGroup };
}

export async function deleteReportSegment(segmentId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("report_segments")
    .delete()
    .eq("id", segmentId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
}

export async function saveReportSegment(data: {
  id: string;
  variant: string;
  summary: string | null;
  content: string | null;
  delivery_day_override_id: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { id, ...rest } = data;
  const { error } = await supabase
    .from("report_segments")
    .update({ ...rest, updated_by: updatedBy })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

function toRoman(n: number): string {
  if (n <= 0) return String(n);
  const pairs: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let rem = n;
  for (const [v, ch] of pairs) {
    while (rem >= v) {
      out += ch;
      rem -= v;
    }
  }
  return out;
}

/**
 * Create a new report segment in the given letter group's report_group.
 * When `deliveryDayId` is provided, it is set as the segment's
 * `delivery_day_override_id` (typically the day after the inspection letter
 * delivers). Returns the new segment's id for the action linkage.
 *
 * Variant selection: scans existing variants in the report group and picks
 * the first unused lowercase roman numeral (i, ii, iii, …). This fills
 * gaps left by deletes instead of colliding on (report_group_id, variant).
 */
export async function createReportSegmentForGroup(
  groupId: string,
  deliveryDayId: string | null = null
): Promise<{ segmentId: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: rg } = await supabase
    .from("report_groups")
    .select("id")
    .eq("letter_group_id", groupId)
    .maybeSingle();
  if (!rg) throw new Error("Report group missing");

  const { data: existing } = await supabase
    .from("report_segments")
    .select("variant")
    .eq("report_group_id", rg.id);
  const taken = new Set((existing ?? []).map((r) => r.variant as string));

  let index = 1;
  let variant = toRoman(index);
  while (taken.has(variant)) {
    index += 1;
    variant = toRoman(index);
  }

  const { data: inserted, error } = await supabase
    .from("report_segments")
    .insert({
      report_group_id: rg.id,
      variant,
      sort_order: index,
      delivery_day_override_id: deliveryDayId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  return { segmentId: inserted!.id as string };
}

/**
 * Create a new day with number = (max existing number) + 1.
 * Returns the new day's id so the caller can select it in a dropdown.
 */
export async function createNextDay(): Promise<{ newDayId: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("days")
    .select("number")
    .order("number", { ascending: false })
    .limit(1);
  const nextNumber = (existing?.[0]?.number ?? 0) + 1;
  const { data, error } = await supabase
    .from("days")
    .insert({ number: nextNumber })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/days");
  return { newDayId: data!.id as string };
}

/**
 * Create the next day in sequence (number = currentDayNumber + 1) and then a
 * report segment delivering on that new day. Used when the inspection letter
 * delivers on the current last day and a report segment still needs to be
 * scheduled for the following day.
 */
export async function createNextDayAndReportSegment(
  groupId: string,
  currentDayNumber: number
): Promise<{ newDayId: string; segmentId: string }> {
  const supabase = await createSupabaseServerClient();
  const nextNumber = currentDayNumber + 1;
  const { data: newDay, error: dayErr } = await supabase
    .from("days")
    .insert({ number: nextNumber })
    .select("id")
    .single();
  if (dayErr) throw new Error(dayErr.message);
  const newDayId = newDay!.id as string;
  const { segmentId } = await createReportSegmentForGroup(groupId, newDayId);
  revalidatePath("/inspection/letters");
  revalidatePath("/days");
  return { newDayId, segmentId };
}

export async function updateCitizen(data: {
  id: string;
  name: string;
  citizen_id: string | null;
  city_id: string | null;
  nation_id: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("citizens")
    .update({
      name: data.name.trim(),
      citizen_id: data.citizen_id?.trim() || null,
      city_id: data.city_id || null,
      nation_id: data.nation_id || null,
    })
    .eq("id", data.id);
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
  revalidatePath("/inspection/letters");
}

export async function quickCreateCitizen(data: {
  name: string;
  type: CitizenType;
  citizen_id?: string | null;
  city_id?: string | null;
  nation_id?: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("citizens")
    .insert({
      name: data.name.trim(),
      type: data.type,
      citizen_id: data.citizen_id?.trim() || null,
      city_id: data.city_id || null,
      nation_id: data.nation_id || null,
    })
    .select("id, name, type, citizen_id, city_id, nation_id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
  return row;
}
