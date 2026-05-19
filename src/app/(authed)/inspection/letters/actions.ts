"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CitizenType, IconType } from "@/lib/db/enums";
import type { LetterGroup } from "@/lib/db/types";

/**
 * Numbering helpers.
 *
 * Display numbers (`letter_groups.sequence`, `inspection_letters.variant` /
 * `piece`, `report_segments.variant`) are assigned ONCE at creation as the
 * next value after the highest existing one, and thereafter changed only by
 * explicit user action (the Edit-ID popup or a "Renumber sequentially"
 * action). Reorder / move / delete never renumber — they touch `sort_order`
 * only. These helpers support next-after-highest assignment.
 */

/** Lowercase subtractive roman-numeral parser. Inverse of `toRoman`. */
function fromRoman(s: string): number {
  const map: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };
  const str = (s ?? "").toLowerCase().trim();
  let total = 0;
  for (let i = 0; i < str.length; i++) {
    const cur = map[str[i]];
    if (cur == null) return 0;
    const next = map[str[i + 1]];
    if (next != null && cur < next) total -= cur;
    else total += cur;
  }
  return total;
}

/**
 * Given the variants currently present in a group, return `count` consecutive
 * lowercase letters after the highest one (or starting at 'a' when empty).
 * Throws past 'z'.
 */
function nextVariantAfterHighest(
  variants: Array<string | null | undefined>,
  count = 1
): string[] {
  let maxCode = 96; // 'a' - 1
  for (const v of variants) {
    if (typeof v === "string" && v.length === 1) {
      const c = v.toLowerCase().charCodeAt(0);
      if (c >= 97 && c <= 122 && c > maxCode) maxCode = c;
    }
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = maxCode + 1 + i;
    if (code > 122) {
      throw new Error("letter group is full — 26 variant letters used");
    }
    out.push(String.fromCharCode(code));
  }
  return out;
}

type EndingAssignmentPatch = {
  variable_id: string;
  value_id: string | null;
};

/**
 * Reconcile an action's ending-variable assignments to a target set via
 * minimum-delta DML — read existing rows, compute insert/update/delete
 * sets keyed by `variable_id`, and apply only those.
 *
 * The previous wipe-and-reinsert pattern caused a visible flicker for
 * peers: each save fired N DELETEs + N INSERTs, and the workspace's
 * postgres handler clears the mirror as DELETEs arrive — for the brief
 * window before the matching INSERTs land, the reconciliation effect
 * rebuilt letterState with empty `ending_assignments`. The user-visible
 * symptom was "all ending variable rows disappear for a moment every
 * time you pick a variable or change a value." Diff-based DML emits at
 * most one event per actual change (e.g. picking a value on an existing
 * variable → one UPDATE, no DELETE) so the mirror is never momentarily
 * inconsistent.
 *
 * Rows with an empty `variable_id` are treated as in-progress local UI
 * state and skipped — picker-open rows the user hasn't bound yet. Rows
 * with `variable_id` set but `value_id` null/empty are persisted, since
 * migration 0033 made `value_id` nullable.
 */
async function replaceEndingAssignments(
  actionId: string,
  assignments: EndingAssignmentPatch[]
) {
  const supabase = await createSupabaseServerClient();

  const { data: existing, error: readErr } = await supabase
    .from("inspection_action_ending_assignments")
    .select("id, variable_id, value_id")
    .eq("action_id", actionId);
  if (readErr) throw new Error(readErr.message);

  const existingByVar = new Map<
    string,
    { id: string; value_id: string | null }
  >();
  for (const r of existing ?? []) {
    existingByVar.set(r.variable_id as string, {
      id: r.id as string,
      value_id: (r.value_id as string | null) ?? null,
    });
  }

  // Dedupe + filter incoming. First non-empty variable_id wins.
  const incoming = new Map<string, string | null>();
  for (const a of assignments) {
    if (!a.variable_id) continue;
    if (incoming.has(a.variable_id)) continue;
    incoming.set(a.variable_id, a.value_id || null);
  }

  const toInsert: Array<{
    action_id: string;
    variable_id: string;
    value_id: string | null;
  }> = [];
  const toUpdate: Array<{ id: string; value_id: string | null }> = [];
  const toDeleteIds: string[] = [];

  for (const [variableId, valueId] of incoming) {
    const ex = existingByVar.get(variableId);
    if (!ex) {
      toInsert.push({
        action_id: actionId,
        variable_id: variableId,
        value_id: valueId,
      });
    } else if (ex.value_id !== valueId) {
      toUpdate.push({ id: ex.id, value_id: valueId });
    }
  }
  for (const [variableId, ex] of existingByVar) {
    if (!incoming.has(variableId)) toDeleteIds.push(ex.id);
  }

  if (toDeleteIds.length > 0) {
    const { error } = await supabase
      .from("inspection_action_ending_assignments")
      .delete()
      .in("id", toDeleteIds);
    if (error) throw new Error(error.message);
  }
  for (const u of toUpdate) {
    const { error } = await supabase
      .from("inspection_action_ending_assignments")
      .update({ value_id: u.value_id })
      .eq("id", u.id);
    if (error) throw new Error(error.message);
  }
  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("inspection_action_ending_assignments")
      .insert(toInsert);
    if (error) throw new Error(error.message);
  }
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

/**
 * Defensive sweep that clears action references whose targets no longer
 * exist. `report_segment_id` is protected by `ON DELETE SET NULL`, so
 * orphans normally don't happen — but we belt-and-suspender it. Called from
 * the workspace + graph page server components on load.
 *
 * `next_letter_id` needs no sweep: it is a real FK with `ON DELETE SET
 * NULL`, so deleting a target letter (or its group, which cascades to its
 * letters) clears the ref automatically.
 */
export async function sweepOrphanActionRefs(): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // Clear report_segment_id refs that no longer resolve.
  const { data: actionsWithSegment } = await supabase
    .from("actions")
    .select("id, report_segment_id")
    .not("report_segment_id", "is", null);
  if (actionsWithSegment && actionsWithSegment.length > 0) {
    const segIds = Array.from(
      new Set(
        actionsWithSegment
          .map((a) => a.report_segment_id as string | null)
          .filter((id): id is string => !!id)
      )
    );
    const { data: liveSegs } = await supabase
      .from("report_segments")
      .select("id")
      .in("id", segIds);
    const liveSet = new Set((liveSegs ?? []).map((s) => s.id as string));
    const orphanActionIds = actionsWithSegment
      .filter((a) => a.report_segment_id && !liveSet.has(a.report_segment_id))
      .map((a) => a.id as string);
    if (orphanActionIds.length > 0) {
      await supabase
        .from("actions")
        .update({ report_segment_id: null })
        .in("id", orphanActionIds);
    }
  }
}

/**
 * Compute the report's default delivery day number: `min(triggering letter
 * effective day) + 1`, falling back to `letter_group.delivery_day + 1` if no
 * triggering letter has an effective day. Returns null if neither anchor
 * exists. This mirrors the SQL in report_segments_view so the action and the
 * view stay consistent.
 */
async function computeReportDefaultDayNumber(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  segmentId: string
): Promise<number | null> {
  const { data: seg } = await supabase
    .from("report_segments")
    .select("report_group_id")
    .eq("id", segmentId)
    .maybeSingle();
  if (!seg) return null;
  const { data: rg } = await supabase
    .from("report_groups")
    .select("letter_group_id")
    .eq("id", seg.report_group_id as string)
    .maybeSingle();
  if (!rg) return null;
  const { data: lg } = await supabase
    .from("letter_groups")
    .select("delivery_day_id")
    .eq("id", rg.letter_group_id as string)
    .maybeSingle();

  const { data: letters } = await supabase
    .from("inspection_letters_view")
    .select("effective_day_id")
    .eq("letter_group_id", rg.letter_group_id as string);
  const letterDayIds = (letters ?? [])
    .map((l) => l.effective_day_id as string | null)
    .filter((id): id is string => !!id);

  let baseNumber: number | null = null;
  if (letterDayIds.length > 0) {
    const { data: dayRows } = await supabase
      .from("days")
      .select("number")
      .in("id", letterDayIds);
    if (dayRows && dayRows.length > 0) {
      baseNumber = Math.min(...dayRows.map((d) => d.number as number));
    }
  }
  if (baseNumber == null && lg?.delivery_day_id) {
    const { data: gd } = await supabase
      .from("days")
      .select("number")
      .eq("id", lg.delivery_day_id as string)
      .maybeSingle();
    baseNumber = gd ? (gd.number as number) : null;
  }
  return baseNumber == null ? null : baseNumber + 1;
}

/**
 * Resolve a target day for a report segment into the storage shape the
 * relative-delivery model expects. Returns the patch payload (offset OR
 * absolute pin OR both-null). Offsets >= 1 become relative; sub-default
 * targets fall back to an absolute pin since the relative menu forbids them.
 */
async function reportSegmentMovePatch(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  segmentId: string,
  dayId: string | null
): Promise<{
  delivery_day_override_id: string | null;
  delivery_day_offset: number | null;
}> {
  if (dayId == null) {
    return { delivery_day_override_id: null, delivery_day_offset: null };
  }
  const { data: target } = await supabase
    .from("days")
    .select("number")
    .eq("id", dayId)
    .maybeSingle();
  const defaultNumber = await computeReportDefaultDayNumber(
    supabase,
    segmentId
  );
  if (!target || defaultNumber == null) {
    return { delivery_day_override_id: dayId, delivery_day_offset: null };
  }
  const offset = (target.number as number) - defaultNumber;
  if (offset === 0) {
    return { delivery_day_override_id: null, delivery_day_offset: null };
  }
  if (offset >= 1) {
    return { delivery_day_override_id: null, delivery_day_offset: offset };
  }
  // Sub-default → only expressible as absolute pin (escape hatch for graph
  // drags; the relative menu forbids offsets < 1).
  return { delivery_day_override_id: dayId, delivery_day_offset: null };
}

/**
 * Restore a report segment's prior delivery override shape verbatim. Used by
 * the graph undo so that undoing a drag on an offset-based segment doesn't
 * collapse to a single "where was it absolutely pinned" view (and lose the
 * offset).
 */
export async function restoreReportSegmentDelivery(
  segmentId: string,
  previousOverrideId: string | null,
  previousOffset: number | null
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { error } = await supabase
    .from("report_segments")
    .update({
      delivery_day_override_id: previousOverrideId,
      delivery_day_offset: previousOffset,
      updated_by: updatedBy,
    })
    .eq("id", segmentId);
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
  const patch = await reportSegmentMovePatch(supabase, segmentId, dayId);
  const { error } = await supabase
    .from("report_segments")
    .update({ ...patch, updated_by: updatedBy })
    .eq("id", segmentId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Move an inspection letter's effective delivery day to `dayId` by storing a
 * RELATIVE offset from its letter group's delivery day. A null target (or a
 * target equal to the group's own day) clears the override entirely. Used by
 * the graph faux-group drag and the "Unpin" context-menu action — both want
 * the letter to keep tracking its group after the move. Falls back to an
 * absolute pin only when the group has no delivery day to anchor against.
 */
export async function moveInspectionLetterToDay(
  letterId: string,
  dayId: string | null
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;

  let overrideId: string | null = null;
  let offset: number | null = null;
  if (dayId != null) {
    const { data: letter } = await supabase
      .from("inspection_letters")
      .select("letter_group_id")
      .eq("id", letterId)
      .maybeSingle();
    let groupDayNumber: number | null = null;
    if (letter) {
      const { data: lg } = await supabase
        .from("letter_groups")
        .select("delivery_day_id")
        .eq("id", letter.letter_group_id as string)
        .maybeSingle();
      if (lg?.delivery_day_id) {
        const { data: gd } = await supabase
          .from("days")
          .select("number")
          .eq("id", lg.delivery_day_id as string)
          .maybeSingle();
        groupDayNumber = gd ? (gd.number as number) : null;
      }
    }
    const { data: target } = await supabase
      .from("days")
      .select("number")
      .eq("id", dayId)
      .maybeSingle();
    if (target && groupDayNumber != null) {
      const delta = (target.number as number) - groupDayNumber;
      offset = delta === 0 ? null : delta;
    } else {
      overrideId = dayId;
    }
  }

  const { error } = await supabase
    .from("inspection_letters")
    .update({
      delivery_day_override_id: overrideId,
      delivery_day_offset: offset,
      updated_by: updatedBy,
    })
    .eq("id", letterId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/** Pin an inspection letter to an absolute delivery day (clears any offset). */
export async function pinInspectionLetterToDay(
  letterId: string,
  dayId: string
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { error } = await supabase
    .from("inspection_letters")
    .update({
      delivery_day_override_id: dayId,
      delivery_day_offset: null,
      updated_by: updatedBy,
    })
    .eq("id", letterId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/** Pin a report segment to an absolute delivery day (clears any offset). */
export async function pinReportSegmentToDay(
  segmentId: string,
  dayId: string
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { error } = await supabase
    .from("report_segments")
    .update({
      delivery_day_override_id: dayId,
      delivery_day_offset: null,
      updated_by: updatedBy,
    })
    .eq("id", segmentId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Move an inspection letter to a different group within the same storyline.
 * The moved letter gets the next-after-highest variant in the target group
 * and its `piece` is cleared (a piece number is meaningless without sibling
 * pieces sharing a variant). The source group keeps a gap — numbering is
 * never auto-compacted. Inbound next-letter links are FK-based
 * (`next_letter_id`), so they follow the moved letter automatically. Rejects
 * cross-storyline moves.
 */
export async function moveLetterToGroup(
  letterId: string,
  targetGroupId: string
) {
  const supabase = await createSupabaseServerClient();

  // Resolve the source letter + groups.
  const { data: letterRow, error: lErr } = await supabase
    .from("inspection_letters")
    .select("id, letter_group_id")
    .eq("id", letterId)
    .single();
  if (lErr || !letterRow) throw new Error(lErr?.message ?? "letter not found");
  const sourceGroupId = letterRow.letter_group_id as string;
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

  // Append into the target group with a fresh sort_order slot and the
  // next-after-highest variant — guaranteed not to collide with the target
  // group's existing (letter_group_id, variant, piece) rows.
  const { data: targetLetters } = await supabase
    .from("inspection_letters")
    .select("sort_order, variant")
    .eq("letter_group_id", targetGroupId);
  const nextSortOrder =
    Math.max(0, ...((targetLetters ?? []).map((l) => l.sort_order ?? 0))) + 1;
  const [nextVariant] = nextVariantAfterHighest(
    (targetLetters ?? []).map((l) => l.variant as string | null)
  );

  const { error: mErr } = await supabase
    .from("inspection_letters")
    .update({
      letter_group_id: targetGroupId,
      sort_order: nextSortOrder,
      variant: nextVariant,
      piece: null,
    })
    .eq("id", letterId);
  if (mErr) throw new Error(mErr.message);

  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Set or clear an action's next-letter link by the target letter id. Used
 * by the narrative graph's edge-reconnect drag and the inspector dropdown.
 *
 * - Passing `null` clears the link (the action's arrow becomes dangling).
 * - Passing a `letterId` validates the target is in the SAME storyline as
 *   the source letter and delivers on a STRICTLY LATER effective day. A
 *   letter with no effective day can be neither a source nor a target.
 *
 * Invalid links (cross-storyline, same/earlier day, unscheduled, missing
 * rows) are silently ignored — the graph snaps back on revalidation.
 */
export async function setActionNextLetterByLetterId(
  actionId: string,
  letterId: string | null
) {
  const supabase = await createSupabaseServerClient();
  if (letterId === null) {
    const { error } = await supabase
      .from("actions")
      .update({ next_letter_id: null })
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
  const srcLetterId = act.inspection_letter_id as string;
  // Resolve both letters' storyline + effective day from the view.
  const { data: letterRows } = await supabase
    .from("inspection_letters_view")
    .select("id, storyline_id, effective_day_id")
    .in("id", [srcLetterId, letterId]);
  const src = letterRows?.find((l) => l.id === srcLetterId);
  const tgt = letterRows?.find((l) => l.id === letterId);
  if (!src || !tgt) return;
  if (src.storyline_id !== tgt.storyline_id) return;
  if (!src.effective_day_id || !tgt.effective_day_id) return;
  // The next letter must deliver strictly later than the source letter.
  const { data: dayRows } = await supabase
    .from("days")
    .select("id, number")
    .in("id", [src.effective_day_id, tgt.effective_day_id]);
  const srcDay = dayRows?.find((d) => d.id === src.effective_day_id);
  const tgtDay = dayRows?.find((d) => d.id === tgt.effective_day_id);
  if (!srcDay || !tgtDay) return;
  if (Number(tgtDay.number) <= Number(srcDay.number)) return;
  const { error } = await supabase
    .from("actions")
    .update({ next_letter_id: letterId })
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
      const patch = await reportSegmentMovePatch(
        supabase,
        m.id,
        m.targetDayId
      );
      const { error } = await supabase
        .from("report_segments")
        .update({ ...patch, updated_by: updatedBy })
        .eq("id", m.id);
      if (error) throw new Error(error.message);
    }
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

export async function deleteGroup(groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  if (updatedBy) {
    await supabase
      .from("letter_groups")
      .update({ updated_by: updatedBy })
      .eq("id", groupId);
  }
  // FK cascade handles report_groups, report_segments, inspection_letters,
  // and (transitively) actions tied to this group's letters. Inbound
  // next-letter links auto-null via the next_letter_id FK (ON DELETE SET
  // NULL) as the cascade removes the target letters.
  const { error } = await supabase
    .from("letter_groups")
    .delete()
    .eq("id", groupId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  // Intentionally no redirect — the caller may be embedded in /graph and
  // we want to stay there. /inspection/letters relies on revalidate to
  // refresh the panel; the deleted group simply disappears from the list.
}

export async function createInspectionLetterInGroup(groupId: string) {
  const ids = await createInspectionLettersInGroup(groupId, 1);
  return ids[0];
}

/**
 * Create 1..3 letters in a group. Each new letter gets the next-after-highest
 * variant (a, b, c…) and a `sort_order` after the current max — gaps left by
 * deletes are never reclaimed.
 */
export async function createInspectionLettersInGroup(
  groupId: string,
  count: number
) {
  const supabase = await createSupabaseServerClient();
  const n = Math.max(1, Math.min(3, count));
  const { data: existing } = await supabase
    .from("inspection_letters")
    .select("sort_order, variant")
    .eq("letter_group_id", groupId);
  const nextStart =
    Math.max(0, ...((existing ?? []).map((l) => Number(l.sort_order ?? 0)))) + 1;
  const variants = nextVariantAfterHighest(
    (existing ?? []).map((l) => l.variant as string | null),
    n
  );
  const toInsert = Array.from({ length: n }, (_, i) => ({
    letter_group_id: groupId,
    sort_order: nextStart + i,
    variant: variants[i],
  }));
  const { data, error } = await supabase
    .from("inspection_letters")
    .insert(toInsert)
    .select("id");
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Create a sibling letter in the same group as `letterId` whose summary /
 * content / sender / receiver / notes / delivery override copies over. The
 * duplicate gets the next-after-highest variant and no `piece` (a fresh
 * variant has no sibling pieces). Returns the new letter id so callers can
 * navigate to it.
 */
export async function duplicateInspectionLetter(
  letterId: string
): Promise<{ newLetterId: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: src, error: srcErr } = await supabase
    .from("inspection_letters")
    .select(
      "letter_group_id, delivery_day_override_id, delivery_day_offset, summary, content, sender_citizen_id, receiver_citizen_id, notes"
    )
    .eq("id", letterId)
    .single();
  if (srcErr || !src) throw new Error(srcErr?.message ?? "letter not found");
  const groupId = src.letter_group_id as string;
  const { data: existing } = await supabase
    .from("inspection_letters")
    .select("sort_order, variant")
    .eq("letter_group_id", groupId);
  const nextSortOrder =
    Math.max(0, ...((existing ?? []).map((l) => Number(l.sort_order ?? 0)))) + 1;
  const [nextVariant] = nextVariantAfterHighest(
    (existing ?? []).map((l) => l.variant as string | null)
  );
  const { data: inserted, error: insErr } = await supabase
    .from("inspection_letters")
    .insert({
      letter_group_id: groupId,
      sort_order: nextSortOrder,
      variant: nextVariant,
      piece: null,
      delivery_day_override_id: src.delivery_day_override_id,
      delivery_day_offset: src.delivery_day_offset,
      summary: src.summary,
      content: src.content,
      sender_citizen_id: src.sender_citizen_id,
      receiver_citizen_id: src.receiver_citizen_id,
      notes: src.notes,
    })
    .select("id")
    .single();
  if (insErr || !inserted)
    throw new Error(insErr?.message ?? "failed to duplicate letter");
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  return { newLetterId: inserted.id as string };
}

/**
 * Create a sibling report segment in the same report_group as
 * `segmentId`, copying its summary / content / delivery override. The new
 * segment gets the next-after-highest roman-numeral variant.
 */
export async function duplicateReportSegment(
  segmentId: string
): Promise<{ newSegmentId: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: src, error: srcErr } = await supabase
    .from("report_segments")
    .select(
      "report_group_id, summary, content, delivery_day_override_id, delivery_day_offset"
    )
    .eq("id", segmentId)
    .single();
  if (srcErr || !src) throw new Error(srcErr?.message ?? "segment not found");
  const reportGroupId = src.report_group_id as string;
  const { data: existing } = await supabase
    .from("report_segments")
    .select("variant, sort_order")
    .eq("report_group_id", reportGroupId);
  const maxRoman = Math.max(
    0,
    ...((existing ?? []).map((r) => fromRoman(r.variant as string)))
  );
  const variant = toRoman(maxRoman + 1);
  const nextSortOrder =
    Math.max(0, ...((existing ?? []).map((r) => r.sort_order as number))) + 1;
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { data: inserted, error: insErr } = await supabase
    .from("report_segments")
    .insert({
      report_group_id: reportGroupId,
      variant,
      sort_order: nextSortOrder,
      summary: src.summary,
      content: src.content,
      delivery_day_override_id: src.delivery_day_override_id,
      delivery_day_offset: src.delivery_day_offset,
      updated_by: updatedBy,
    })
    .select("id")
    .single();
  if (insErr || !inserted)
    throw new Error(insErr?.message ?? "failed to duplicate segment");
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  return { newSegmentId: inserted.id as string };
}

export async function deleteInspectionLetter(
  _groupId: string,
  letterId: string
) {
  const supabase = await createSupabaseServerClient();
  // Stamp updated_by before the delete so peers' deletion toasts can name
  // the deleter (the row vanishes before realtime sees the new value
  // otherwise). The variant / piece columns are intentionally left alone —
  // surviving letters keep their numbers; gaps stay.
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  if (updatedBy) {
    await supabase
      .from("inspection_letters")
      .update({ updated_by: updatedBy })
      .eq("id", letterId);
  }
  // FK cascade on actions.inspection_letter_id removes this letter's own
  // actions; the next_letter_id FK (ON DELETE SET NULL) clears any inbound
  // next-letter links automatically. The surviving letters keep their
  // variant / piece numbers — gaps are intentional, never auto-compacted.
  const { error } = await supabase
    .from("inspection_letters")
    .delete()
    .eq("id", letterId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Add a new "piece" to an existing letter: both the source letter and the
 * new letter share the same variant and are numbered consecutively. If the
 * source letter had no variant yet, the next-after-highest variant is
 * assigned so pieces can be referenced. When the source was the only member
 * of its variant cluster (piece null), it is promoted to piece 1 and the new
 * letter becomes piece 2; otherwise the new letter gets max(piece) + 1.
 * Returns the new letter's id.
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

  const { data: siblings } = await supabase
    .from("inspection_letters")
    .select("id, variant, piece")
    .eq("letter_group_id", groupId);
  const sibs = siblings ?? [];

  // Ensure the source letter has a variant — otherwise we can't group pieces.
  let variant = (current.variant ?? null) as string | null;
  if (!variant) {
    [variant] = nextVariantAfterHighest(
      sibs.map((s) => s.variant as string | null)
    );
    await supabase
      .from("inspection_letters")
      .update({ variant })
      .eq("id", letterId);
  }

  // Determine the new piece number from the current variant cluster.
  const cluster = sibs.filter(
    (s) => s.id === letterId || s.variant === variant
  );
  let nextPiece: number;
  if (cluster.length <= 1) {
    // Source was the lone member — promote it to piece 1, new becomes 2.
    await supabase
      .from("inspection_letters")
      .update({ piece: 1 })
      .eq("id", letterId);
    nextPiece = 2;
  } else {
    nextPiece =
      Math.max(0, ...cluster.map((s) => Number(s.piece ?? 0))) + 1;
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
      piece: nextPiece,
      sort_order: currentSort + 1,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const newLetterId = inserted!.id as string;

  revalidatePath("/inspection/letters");
  return { newLetterId };
}

/**
 * Reorder letters within a group. Updates `sort_order` only — variant / piece
 * numbers are deliberately left alone so display IDs stay stable.
 */
export async function reorderInspectionLetters(
  _groupId: string,
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
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Reorder report segments within a report group. Updates `sort_order` only —
 * the Roman-numeral `variant` is left untouched so display IDs (R-W2/ii…)
 * stay stable. Use the Edit-ID popup or "Renumber sequentially" to change
 * variants explicitly.
 */
export async function reorderReportSegments(orderedIds: string[]) {
  const supabase = await createSupabaseServerClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("report_segments")
      .update({ sort_order: i + 1 })
      .eq("id", orderedIds[i]);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Reorder letter groups within a storyline. Updates `sort_order` only — the
 * display-ID `sequence` is left untouched so letter / report IDs stay stable.
 */
export async function reorderLetterGroups(
  storylineId: string,
  orderedIds: string[]
) {
  const supabase = await createSupabaseServerClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("letter_groups")
      .update({ sort_order: i + 1 })
      .eq("id", orderedIds[i])
      .eq("storyline_id", storylineId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  revalidatePath(`/inspection/storylines/${storylineId}`);
}

// ---------------------------------------------------------------------------
// Explicit renumbering
//
// The only paths that change display numbers. Each does a two-pass temp-park
// (mirroring renumberGenericReportBlocks) so a row-by-row UPDATE never trips a
// unique constraint mid-flight: pass 1 parks every affected row on a
// guaranteed-distinct value, pass 2 writes the finals. Non-transactional — a
// crash between passes leaves rows parked and a re-run self-heals.
// ---------------------------------------------------------------------------

/**
 * Renumber a storyline's letter groups so `sequence` = 1, 2, 3… in their
 * current `sort_order`. Letter / report display IDs follow automatically
 * (the views interpolate `lg.sequence`). Delegates to applyLetterGroupSequences
 * — its RPC applies the change atomically.
 */
export async function renumberLetterGroupsSequentially(storylineId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("letter_groups")
    .select("id")
    .eq("storyline_id", storylineId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  const assignments = (rows ?? []).map((r, i) => ({
    groupId: r.id as string,
    newSequence: i + 1,
  }));
  await applyLetterGroupSequences(storylineId, assignments);
}

/**
 * Renumber a group's letters so `variant` = a, b, c… in their current
 * `sort_order`. Letters that shared a variant (piece clusters) keep sharing
 * one new variant, and their `piece` values are preserved.
 */
export async function renumberInspectionLettersSequentially(groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("inspection_letters")
    .select("id, variant, piece")
    .eq("letter_group_id", groupId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  // Assign a, b, c… by sort order, keeping piece-cluster grouping (letters
  // that shared a variant keep sharing one new variant); pieces preserved.
  const remap = new Map<string, string>();
  let nextCode = 97;
  const assignments = (rows ?? []).map((r) => {
    const old = (r.variant ?? null) as string | null;
    let nv: string;
    if (old != null && remap.has(old)) {
      nv = remap.get(old) as string;
    } else {
      if (nextCode > 122) {
        throw new Error("group has more than 26 distinct variants");
      }
      nv = String.fromCharCode(nextCode);
      nextCode += 1;
      if (old != null) remap.set(old, nv);
    }
    return {
      letterId: r.id as string,
      newVariant: nv,
      newPiece: (r.piece ?? null) as number | null,
    };
  });
  await applyInspectionLetterVariants(groupId, assignments);
}

/**
 * Renumber a report group's segments so `variant` = i, ii, iii… in their
 * current `sort_order`.
 */
export async function renumberReportSegmentsSequentially(
  reportGroupId: string
) {
  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("report_segments")
    .select("id")
    .eq("report_group_id", reportGroupId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  const assignments = (rows ?? []).map((r, i) => ({
    segmentId: r.id as string,
    newVariant: toRoman(i + 1),
  }));
  await applyReportSegmentVariants(reportGroupId, assignments);
}

/**
 * Apply a conflict-free set of letter-group sequence edits (from the Edit-ID
 * popup or a renumber). The park → final two-pass that dodges
 * UNIQUE(storyline_id, sequence) runs inside one transaction in the
 * `apply_letter_group_sequences` RPC, so it applies all-or-nothing.
 */
export async function applyLetterGroupSequences(
  storylineId: string,
  assignments: Array<{ groupId: string; newSequence: number }>
) {
  if (assignments.length === 0) return;
  const seqs = assignments.map((a) => a.newSequence);
  if (seqs.some((s) => !Number.isInteger(s) || s < 1)) {
    throw new Error("sequence numbers must be positive integers");
  }
  if (new Set(seqs).size !== seqs.length) {
    throw new Error("duplicate target sequence numbers");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("apply_letter_group_sequences", {
    p_storyline_id: storylineId,
    p_assignments: assignments,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  revalidatePath(`/inspection/storylines/${storylineId}`);
}

/**
 * Apply a conflict-free set of inspection-letter variant/piece edits. The
 * park → final two-pass runs atomically inside the
 * `apply_inspection_letter_variants` RPC.
 */
export async function applyInspectionLetterVariants(
  groupId: string,
  assignments: Array<{
    letterId: string;
    newVariant: string;
    newPiece: number | null;
  }>
) {
  if (assignments.length === 0) return;
  const keys = assignments.map((a) => `${a.newVariant}/${a.newPiece ?? ""}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error("duplicate target variant/piece");
  }
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.rpc("apply_inspection_letter_variants", {
    p_group_id: groupId,
    p_assignments: assignments,
    p_updated_by: userData.user?.email ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Apply a conflict-free set of report-segment variant edits. The park →
 * final two-pass runs atomically inside the `apply_report_segment_variants`
 * RPC (`report_segments.variant` is text NOT NULL, so it parks on `tmp-<id>`
 * tokens rather than NULL).
 */
export async function applyReportSegmentVariants(
  reportGroupId: string,
  assignments: Array<{ segmentId: string; newVariant: string }>
) {
  if (assignments.length === 0) return;
  const vs = assignments.map((a) => a.newVariant);
  if (vs.some((v) => !v)) throw new Error("variant must not be empty");
  if (new Set(vs).size !== vs.length) {
    throw new Error("duplicate target variants");
  }
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.rpc("apply_report_segment_variants", {
    p_report_group_id: reportGroupId,
    p_assignments: assignments,
    p_updated_by: userData.user?.email ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/** Shared chronological comparator builder for the sort-by-day actions. */
function byDayThenSort(
  dayNum: Map<string, number>
): (
  a: { id: string; sort_order: number | null; dayId: string | null },
  b: { id: string; sort_order: number | null; dayId: string | null }
) => number {
  return (a, b) => {
    const da = a.dayId ? dayNum.get(a.dayId) ?? Infinity : Infinity;
    const db = b.dayId ? dayNum.get(b.dayId) ?? Infinity : Infinity;
    if (da !== db) return da - db;
    const sa = Number(a.sort_order ?? 0);
    const sb = Number(b.sort_order ?? 0);
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  };
}

async function loadDayNumbers(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
): Promise<Map<string, number>> {
  const { data: days } = await supabase.from("days").select("id, number");
  return new Map<string, number>(
    (days ?? []).map((d) => [d.id as string, Number(d.number)])
  );
}

/**
 * Rewrite a storyline's letter-group `sort_order` so the list is ordered by
 * delivery day. Dateless groups sink to the end keeping their relative order.
 * Display IDs (`sequence`) are untouched.
 */
export async function sortLetterGroupsChronologically(storylineId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: groups, error } = await supabase
    .from("letter_groups")
    .select("id, sort_order, delivery_day_id")
    .eq("storyline_id", storylineId);
  if (error) throw new Error(error.message);
  const dayNum = await loadDayNumbers(supabase);
  const ordered = (groups ?? [])
    .map((g) => ({
      id: g.id as string,
      sort_order: g.sort_order as number | null,
      dayId: (g.delivery_day_id as string | null) ?? null,
    }))
    .sort(byDayThenSort(dayNum));
  for (let i = 0; i < ordered.length; i++) {
    const { error: e } = await supabase
      .from("letter_groups")
      .update({ sort_order: i + 1 })
      .eq("id", ordered[i].id);
    if (e) throw new Error(e.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  revalidatePath(`/inspection/storylines/${storylineId}`);
}

/**
 * Rewrite a group's inspection-letter `sort_order` so the list is ordered by
 * effective delivery day. Variant / piece numbers are untouched.
 */
export async function sortInspectionLettersChronologically(groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: letters, error } = await supabase
    .from("inspection_letters_view")
    .select("id, sort_order, effective_day_id")
    .eq("letter_group_id", groupId);
  if (error) throw new Error(error.message);
  const dayNum = await loadDayNumbers(supabase);
  const ordered = (letters ?? [])
    .map((l) => ({
      id: l.id as string,
      sort_order: l.sort_order as number | null,
      dayId: (l.effective_day_id as string | null) ?? null,
    }))
    .sort(byDayThenSort(dayNum));
  for (let i = 0; i < ordered.length; i++) {
    const { error: e } = await supabase
      .from("inspection_letters")
      .update({ sort_order: i + 1 })
      .eq("id", ordered[i].id);
    if (e) throw new Error(e.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Rewrite a report group's segment `sort_order` so the list is ordered by
 * effective delivery day. Roman-numeral variants are untouched.
 */
export async function sortReportSegmentsChronologically(reportGroupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: segments, error } = await supabase
    .from("report_segments_view")
    .select("id, sort_order, effective_day_id")
    .eq("report_group_id", reportGroupId);
  if (error) throw new Error(error.message);
  const dayNum = await loadDayNumbers(supabase);
  const ordered = (segments ?? [])
    .map((s) => ({
      id: s.id as string,
      sort_order: s.sort_order as number | null,
      dayId: (s.effective_day_id as string | null) ?? null,
    }))
    .sort(byDayThenSort(dayNum));
  for (let i = 0; i < ordered.length; i++) {
    const { error: e } = await supabase
      .from("report_segments")
      .update({ sort_order: i + 1 })
      .eq("id", ordered[i].id);
    if (e) throw new Error(e.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Rewrite a storyline's letter-group `sort_order` so the list is ordered by
 * display ID (`sequence`). Sequence itself is untouched.
 */
export async function sortLetterGroupsById(storylineId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: groups, error } = await supabase
    .from("letter_groups")
    .select("id, sequence")
    .eq("storyline_id", storylineId);
  if (error) throw new Error(error.message);
  const ordered = (groups ?? [])
    .slice()
    .sort(
      (a, b) =>
        Number(a.sequence ?? 0) - Number(b.sequence ?? 0) ||
        (a.id as string).localeCompare(b.id as string)
    );
  for (let i = 0; i < ordered.length; i++) {
    const { error: e } = await supabase
      .from("letter_groups")
      .update({ sort_order: i + 1 })
      .eq("id", ordered[i].id as string);
    if (e) throw new Error(e.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  revalidatePath(`/inspection/storylines/${storylineId}`);
}

/**
 * Rewrite a group's inspection-letter `sort_order` so the list is ordered by
 * display ID (`variant`, then `piece`). Null variants sink to the end.
 */
export async function sortInspectionLettersById(groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: letters, error } = await supabase
    .from("inspection_letters")
    .select("id, variant, piece")
    .eq("letter_group_id", groupId);
  if (error) throw new Error(error.message);
  const ordered = (letters ?? []).slice().sort((a, b) => {
    const va = (a.variant as string | null) ?? "";
    const vb = (b.variant as string | null) ?? "";
    if (va !== vb) {
      if (va === "") return 1;
      if (vb === "") return -1;
      return va.localeCompare(vb);
    }
    return Number(a.piece ?? 0) - Number(b.piece ?? 0);
  });
  for (let i = 0; i < ordered.length; i++) {
    const { error: e } = await supabase
      .from("inspection_letters")
      .update({ sort_order: i + 1 })
      .eq("id", ordered[i].id as string);
    if (e) throw new Error(e.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
}

/**
 * Rewrite a report group's segment `sort_order` so the list is ordered by
 * display ID (the roman-numeral `variant`).
 */
export async function sortReportSegmentsById(reportGroupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: segments, error } = await supabase
    .from("report_segments")
    .select("id, variant")
    .eq("report_group_id", reportGroupId);
  if (error) throw new Error(error.message);
  const ordered = (segments ?? [])
    .slice()
    .sort(
      (a, b) =>
        fromRoman(a.variant as string) - fromRoman(b.variant as string) ||
        (a.id as string).localeCompare(b.id as string)
    );
  for (let i = 0; i < ordered.length; i++) {
    const { error: e } = await supabase
      .from("report_segments")
      .update({ sort_order: i + 1 })
      .eq("id", ordered[i].id as string);
    if (e) throw new Error(e.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
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
  delivery_day_offset: number | null;
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
  const normalized: Partial<InspectionLetterPatchFields> = { ...patch };
  if (
    "delivery_day_offset" in normalized &&
    normalized.delivery_day_offset !== null &&
    normalized.delivery_day_offset !== undefined
  ) {
    normalized.delivery_day_override_id = null;
  } else if (
    "delivery_day_override_id" in normalized &&
    normalized.delivery_day_override_id !== null &&
    normalized.delivery_day_override_id !== undefined
  ) {
    normalized.delivery_day_offset = null;
  }
  const { error } = await supabase
    .from("inspection_letters")
    .update({ ...normalized, updated_by: updatedBy })
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
  next_letter_id: string | null;
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
  delivery_day_offset: number | null;
};

export async function patchReportSegment(
  id: string,
  patch: Partial<ReportSegmentPatchFields>
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const normalized: Partial<ReportSegmentPatchFields> = { ...patch };
  if (
    "delivery_day_offset" in normalized &&
    normalized.delivery_day_offset !== null &&
    normalized.delivery_day_offset !== undefined
  ) {
    normalized.delivery_day_override_id = null;
  } else if (
    "delivery_day_override_id" in normalized &&
    normalized.delivery_day_override_id !== null &&
    normalized.delivery_day_override_id !== undefined
  ) {
    normalized.delivery_day_offset = null;
  }
  const { error } = await supabase
    .from("report_segments")
    .update({ ...normalized, updated_by: updatedBy })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addActionFromTemplate(
  groupId: string,
  letterId: string,
  templateId: string,
  /** When false, only the picked template is inserted even if it has a
   *  paired template — used by the "add just one of a pair" menu path.
   *  Defaults true so the legacy "add the pair" behavior is preserved. */
  includePair = true
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
  if (includePair && tpl.paired_template_id) {
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
 * Create a new letter in the "next" letter group (by sequence) in the same
 * storyline. Returns the new letter's id so the caller can set it as the
 * action's `next_letter_id`.
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
 * Returns the new letter's id for the action's `next_letter_id` link.
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
    .select("sequence, sort_order")
    .eq("storyline_id", cur.storyline_id);
  const nextSeq =
    Math.max(0, ...((existing ?? []).map((g) => Number(g.sequence ?? 0)))) + 1;
  const nextSort =
    Math.max(0, ...((existing ?? []).map((g) => Number(g.sort_order ?? 0)))) +
    1;
  const { data: newGroup, error } = await supabase
    .from("letter_groups")
    .insert({
      storyline_id: cur.storyline_id,
      name: `Group ${nextSeq}`,
      sequence: nextSeq,
      sort_order: nextSort,
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
  storylineId: string,
  deliveryDayId: string | null = null
): Promise<{ group: LetterGroup }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("letter_groups")
    .select("sequence, sort_order")
    .eq("storyline_id", storylineId);
  const nextSeq =
    Math.max(0, ...((existing ?? []).map((g) => Number(g.sequence ?? 0)))) + 1;
  const nextSort =
    Math.max(0, ...((existing ?? []).map((g) => Number(g.sort_order ?? 0)))) +
    1;
  const { data, error } = await supabase
    .from("letter_groups")
    .insert({
      storyline_id: storylineId,
      name: `Group ${nextSeq}`,
      sequence: nextSeq,
      sort_order: nextSort,
      delivery_day_id: deliveryDayId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath("/graph");
  revalidatePath(`/inspection/storylines/${storylineId}`);
  return { group: data as LetterGroup };
}

export async function deleteReportSegment(segmentId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  if (updatedBy) {
    await supabase
      .from("report_segments")
      .update({ updated_by: updatedBy })
      .eq("id", segmentId);
  }
  const { error } = await supabase
    .from("report_segments")
    .delete()
    .eq("id", segmentId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
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
 * Variant selection: the next lowercase roman numeral after the highest one
 * already used in the report group (i, ii, iii, …). Gaps left by deletes are
 * never reclaimed — numbering only grows.
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
    .select("variant, sort_order")
    .eq("report_group_id", rg.id);
  const maxRoman = Math.max(
    0,
    ...((existing ?? []).map((r) => fromRoman(r.variant as string)))
  );
  const variant = toRoman(maxRoman + 1);
  const nextSortOrder =
    Math.max(0, ...((existing ?? []).map((r) => Number(r.sort_order ?? 0)))) +
    1;

  const { data: inserted, error } = await supabase
    .from("report_segments")
    .insert({
      report_group_id: rg.id,
      variant,
      sort_order: nextSortOrder,
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
 * Create N report segments under a letter group, each pinned to an
 * absolute day via delivery_day_override_id. Used by the graph's pane
 * right-click menu where the user picks a day visually.
 */
export async function createReportSegmentsForGroupAtDay(
  groupId: string,
  count: number,
  deliveryDayId: string | null
): Promise<{ segmentIds: string[] }> {
  const n = Math.max(1, Math.min(3, count));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { segmentId } = await createReportSegmentForGroup(
      groupId,
      deliveryDayId
    );
    ids.push(segmentId);
  }
  return { segmentIds: ids };
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
  revalidatePath("/graph");
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
  first_name: string;
  last_name: string;
  citizen_id: string | null;
  city_id: string | null;
  nation_id: string | null;
  middle_name?: string | null;
  honorific?: string | null;
  title?: string | null;
  suffix?: string | null;
  name_display_format?: string | null;
  address_line?: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("citizens")
    .update({
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      citizen_id: data.citizen_id?.trim() || null,
      city_id: data.city_id || null,
      nation_id: data.nation_id || null,
      middle_name: data.middle_name?.trim() || null,
      honorific: data.honorific?.trim() || null,
      title: data.title?.trim() || null,
      suffix: data.suffix?.trim() || null,
      name_display_format: data.name_display_format?.trim() || null,
      address_line: data.address_line?.trim() || null,
    })
    .eq("id", data.id);
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
  revalidatePath("/inspection/letters");
}

export async function quickCreateCitizen(data: {
  first_name: string;
  last_name: string;
  type: CitizenType;
  citizen_id?: string | null;
  city_id?: string | null;
  nation_id?: string | null;
  middle_name?: string | null;
  honorific?: string | null;
  title?: string | null;
  suffix?: string | null;
  name_display_format?: string | null;
  address_line?: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("citizens")
    .insert({
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      type: data.type,
      citizen_id: data.citizen_id?.trim() || null,
      city_id: data.city_id || null,
      nation_id: data.nation_id || null,
      middle_name: data.middle_name?.trim() || null,
      honorific: data.honorific?.trim() || null,
      title: data.title?.trim() || null,
      suffix: data.suffix?.trim() || null,
      name_display_format: data.name_display_format?.trim() || null,
      address_line: data.address_line?.trim() || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
  return row;
}
