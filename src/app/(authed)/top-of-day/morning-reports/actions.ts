"use server";

// Server actions for the Morning Reports page. Narrow `patch*` actions skip
// `revalidatePath` (realtime postgres_changes fans the edit out); structural
// actions (create / delete / reorder) revalidate so the acting tab re-renders.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toRoman } from "@/lib/utils";
import type { DayReportBlockKind } from "@/lib/db/enums";

const ROUTE = "/top-of-day/morning-reports";

/**
 * Create a generic (day-attached) report block. Picks the next free roman
 * `variant` not used by another generic block on the day, and appends it
 * after the day's last block.
 */
export async function createGenericReportBlock(input: {
  day_id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: rows, error: readErr } = await supabase
    .from("day_report_blocks")
    .select("variant, sort_order")
    .eq("day_id", input.day_id);
  if (readErr) throw new Error(readErr.message);
  const existing = rows ?? [];
  const taken = new Set(
    existing
      .map((r) => r.variant as string | null)
      .filter((v): v is string => Boolean(v))
  );
  let index = 1;
  let variant = toRoman(index);
  while (taken.has(variant)) {
    index += 1;
    variant = toRoman(index);
  }
  const maxSort = existing.reduce(
    (m, r) => Math.max(m, (r.sort_order as number) ?? 0),
    -1
  );
  const { data: userData } = await supabase.auth.getUser();
  const { data: inserted, error } = await supabase
    .from("day_report_blocks")
    .insert({
      day_id: input.day_id,
      kind: "generic",
      variant,
      sort_order: maxSort + 1,
      updated_by: userData.user?.email ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(ROUTE);
  return { id: inserted!.id as string };
}

/** Autosave patch for a generic report block's content / summary. */
export async function patchGenericReportBlock(
  id: string,
  patch: Partial<{ content: string | null; summary: string | null }>
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const update: Record<string, unknown> = {
    updated_by: userData.user?.email ?? null,
  };
  if (patch.content !== undefined) update.content = patch.content;
  if (patch.summary !== undefined) update.summary = patch.summary;
  const { error } = await supabase
    .from("day_report_blocks")
    .update(update)
    .eq("id", id)
    .eq("kind", "generic");
  if (error) throw new Error(error.message);
}

/**
 * Delete a generic report block. The `kind='generic'` filter means a
 * letter-group anchor row can never be deleted through this action.
 */
export async function deleteGenericReportBlock(
  formData: FormData
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing block id");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("day_report_blocks")
    .delete()
    .eq("id", id)
    .eq("kind", "generic");
  if (error) throw new Error(error.message);
  revalidatePath(ROUTE);
}

/**
 * Persist the shared per-day order of the middle section. Entries with an
 * `id` are UPDATEd in place; `letter_group` entries without an `id` get a
 * fresh anchor row INSERTed — anchors are created lazily on first reorder,
 * never during page render.
 */
export async function reorderDayReportBlocks(input: {
  day_id: string;
  blocks: Array<{
    id: string | null;
    kind: DayReportBlockKind;
    letter_group_id: string | null;
    sort_order: number;
  }>;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const updates = input.blocks.filter((b) => b.id);
  const inserts = input.blocks.filter(
    (b) => !b.id && b.kind === "letter_group" && b.letter_group_id
  );
  for (const b of updates) {
    const { error } = await supabase
      .from("day_report_blocks")
      .update({ sort_order: b.sort_order })
      .eq("id", b.id as string);
    if (error) throw new Error(error.message);
  }
  if (inserts.length > 0) {
    const { error } = await supabase.from("day_report_blocks").insert(
      inserts.map((b) => ({
        day_id: input.day_id,
        kind: "letter_group" as const,
        letter_group_id: b.letter_group_id,
        sort_order: b.sort_order,
      }))
    );
    if (error) throw new Error(error.message);
  }
  revalidatePath(ROUTE);
}

/**
 * Renumber a day's generic report blocks: walk them in current
 * `sort_order` and reassign `variant` to sequential roman numerals
 * starting at `i`. Done in two passes so the transient values never
 * collide with the `(day_id, variant)` partial unique index.
 */
export async function renumberGenericReportBlocks(
  dayId: string
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("day_report_blocks")
    .select("id, sort_order")
    .eq("day_id", dayId)
    .eq("kind", "generic")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  // Pass 1 — park every row on a guaranteed-unique temp variant.
  for (const r of rows) {
    const { error: e1 } = await supabase
      .from("day_report_blocks")
      .update({ variant: `tmp-${r.id}` })
      .eq("id", r.id);
    if (e1) throw new Error(e1.message);
  }
  // Pass 2 — assign the final sequential roman numerals.
  for (let i = 0; i < rows.length; i += 1) {
    const { error: e2 } = await supabase
      .from("day_report_blocks")
      .update({ variant: toRoman(i + 1) })
      .eq("id", rows[i].id);
    if (e2) throw new Error(e2.message);
  }
  revalidatePath(ROUTE);
}

/** Autosave patch for the pinned intro / sign-off text on a day. */
export async function patchDayReportField(
  dayId: string,
  patch: Partial<{
    base_report: string | null;
    report_sign_off: string | null;
  }>
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.base_report !== undefined) update.base_report = patch.base_report;
  if (patch.report_sign_off !== undefined) {
    update.report_sign_off = patch.report_sign_off;
  }
  if (Object.keys(update).length === 0) return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("days").update(update).eq("id", dayId);
  if (error) throw new Error(error.message);
}
