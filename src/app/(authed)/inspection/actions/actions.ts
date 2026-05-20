"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeHex } from "@/lib/color";
import type { IconType } from "@/lib/db/enums";

type TemplatePatch = {
  name?: string;
  icon_type?: IconType;
  icon_value?: string | null;
  color_hex?: string;
  sort_order?: number;
  group_id?: string | null;
};

type GroupPatch = {
  name?: string | null;
  sort_order?: number;
};

function revalidateActionSurfaces() {
  revalidatePath("/inspection/actions");
  revalidatePath("/inspection/letters");
}

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * After any operation that potentially moves a template out of `groupId`,
 * delete the group if it has no remaining members. The UI rule is that
 * every action lives in a group; empty groups are a transient state we
 * clean up immediately so the list never shows a phantom group header.
 */
async function deleteGroupIfEmpty(
  supabase: SupabaseClient,
  groupId: string | null
) {
  if (!groupId) return;
  const { count } = await supabase
    .from("action_templates")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);
  if ((count ?? 0) === 0) {
    await supabase.from("action_template_groups").delete().eq("id", groupId);
  }
}

/**
 * Compute the next top-level sort_order across both templates AND groups.
 * Top-level templates are deprecated (every template lives in a group now),
 * so in practice only groups consume top-level slots — but keep both checks
 * defensively in case a template slips through.
 */
async function nextTopLevelSortOrder(supabase: SupabaseClient): Promise<number> {
  const [{ data: tpl }, { data: grp }] = await Promise.all([
    supabase
      .from("action_templates")
      .select("sort_order")
      .is("group_id", null)
      .order("sort_order", { ascending: false })
      .limit(1),
    supabase
      .from("action_template_groups")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1),
  ]);
  return (
    Math.max(tpl?.[0]?.sort_order ?? -1, grp?.[0]?.sort_order ?? -1) + 1
  );
}

const UNGROUPED_NAME = "Ungrouped";
const NEW_ACTION_BASE = "New action";

/**
 * Find the existing "Ungrouped" bucket group (case-insensitive on the
 * literal name "Ungrouped") or create one at the end of the top-level list.
 */
async function findOrCreateUngroupedGroup(
  supabase: SupabaseClient
): Promise<string> {
  const { data: existing } = await supabase
    .from("action_template_groups")
    .select("id")
    .ilike("name", UNGROUPED_NAME)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;
  const sortOrder = await nextTopLevelSortOrder(supabase);
  const { data, error } = await supabase
    .from("action_template_groups")
    .insert({ name: UNGROUPED_NAME, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/**
 * Pick a unique-by-lowercase template name. Starts at `base`; if taken,
 * walks `${base} 2`, `${base} 3`, … Matches the case-insensitive uniqueness
 * imposed by the `action_templates_name_lower_unique` index.
 */
async function nextUniqueTemplateName(
  supabase: SupabaseClient,
  base: string
): Promise<string> {
  const { data } = await supabase
    .from("action_templates")
    .select("name")
    .ilike("name", `${base}%`);
  const taken = new Set(
    (data ?? []).map((r) => (r.name as string).toLowerCase())
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // Extreme fallback — unreachable in practice.
  return `${base} ${Date.now()}`;
}

/**
 * Create a new action template. Every new template lands in the shared
 * "Ungrouped" group (find-or-created on first use), so the user has a
 * predictable bucket for fresh work. To start a fresh group instead, use
 * `createActionTemplateGroup`.
 *
 * Returns the new ids so optimistic clients can swap their ghosts for
 * real rows.
 */
export async function createActionTemplate(): Promise<{
  templateId: string;
  groupId: string;
}> {
  const supabase = await createSupabaseServerClient();
  const groupId = await findOrCreateUngroupedGroup(supabase);
  const name = await nextUniqueTemplateName(supabase, NEW_ACTION_BASE);

  // Place this template at the end of the Ungrouped group's member list.
  const { data: tail } = await supabase
    .from("action_templates")
    .select("sort_order")
    .eq("group_id", groupId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const sortOrder = (tail?.[0]?.sort_order ?? -1) + 1;

  const { data: tplRow, error: tplErr } = await supabase
    .from("action_templates")
    .insert({
      name,
      icon_type: "lucide" as IconType,
      color_hex: "#888888",
      sort_order: sortOrder,
      group_id: groupId,
    })
    .select("id")
    .single();
  if (tplErr) throw new Error(tplErr.message);

  revalidateActionSurfaces();
  return { templateId: tplRow.id, groupId };
}

export async function patchActionTemplate(id: string, patch: TemplatePatch) {
  if (!id) return;
  const supabase = await createSupabaseServerClient();
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name.trim() || "Untitled";
  if (patch.icon_type !== undefined) payload.icon_type = patch.icon_type;
  if (patch.icon_value !== undefined)
    payload.icon_value = patch.icon_value ? patch.icon_value : null;
  if (patch.color_hex !== undefined)
    payload.color_hex = normalizeHex(patch.color_hex);
  if (patch.sort_order !== undefined) payload.sort_order = patch.sort_order;
  if (patch.group_id !== undefined) payload.group_id = patch.group_id;
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase
    .from("action_templates")
    .update(payload)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateActionSurfaces();
}

/**
 * Duplicate a template into its own brand-new solo group. The clone's
 * sort_order matches the source's group's position + 1, so it lands at the
 * end of the top-level list (callers don't need to renumber).
 */
export async function duplicateActionTemplate(id: string): Promise<{
  templateId: string;
  groupId: string;
}> {
  if (!id) throw new Error("Missing template id");
  const supabase = await createSupabaseServerClient();
  const { data: src, error: srcErr } = await supabase
    .from("action_templates")
    .select("name, icon_type, icon_value, color_hex")
    .eq("id", id)
    .maybeSingle();
  if (srcErr) throw new Error(srcErr.message);
  if (!src) throw new Error("Template not found");

  const sortOrder = await nextTopLevelSortOrder(supabase);

  const { data: groupRow, error: groupErr } = await supabase
    .from("action_template_groups")
    .insert({ name: null, sort_order: sortOrder })
    .select("id")
    .single();
  if (groupErr) throw new Error(groupErr.message);

  const copyName = await nextUniqueTemplateName(
    supabase,
    `${src.name} (copy)`
  );
  const { data: tplRow, error: tplErr } = await supabase
    .from("action_templates")
    .insert({
      name: copyName,
      icon_type: src.icon_type,
      icon_value: src.icon_value,
      color_hex: src.color_hex,
      sort_order: 0,
      group_id: groupRow.id,
    })
    .select("id")
    .single();
  if (tplErr) throw new Error(tplErr.message);

  revalidateActionSurfaces();
  return { templateId: tplRow.id, groupId: groupRow.id };
}

/**
 * Delete a template. If it was the last member of its group, the group is
 * also deleted (the "every action lives in a group" invariant means the
 * empty group is meaningless and would otherwise stay as a phantom header).
 */
export async function deleteActionTemplate(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { data: src } = await supabase
    .from("action_templates")
    .select("group_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("action_templates")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  await deleteGroupIfEmpty(supabase, src?.group_id ?? null);
  revalidateActionSurfaces();
}

export async function createActionTemplateGroup(): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const sortOrder = await nextTopLevelSortOrder(supabase);
  const { data, error } = await supabase
    .from("action_template_groups")
    .insert({ name: null, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateActionSurfaces();
  return { id: data.id };
}

export async function patchActionTemplateGroup(id: string, patch: GroupPatch) {
  if (!id) return;
  const supabase = await createSupabaseServerClient();
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined)
    payload.name = patch.name?.trim() ? patch.name.trim() : null;
  if (patch.sort_order !== undefined) payload.sort_order = patch.sort_order;
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase
    .from("action_template_groups")
    .update(payload)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateActionSurfaces();
}

/**
 * Delete a group AND every member template inside it. The "Ungroup all"
 * affordance has been retired — under the new rule that every action lives
 * in a group, ungrouping members would have to spawn a new group for each,
 * which is just a rename of "delete group keeping members" with extra
 * confusion. If a user wants to keep the actions, they should move them to
 * other groups first.
 */
export async function deleteActionTemplateGroup(id: string) {
  if (!id) return;
  const supabase = await createSupabaseServerClient();
  // Templates are deleted by FK cascade in app logic (no ON DELETE CASCADE
  // on group_id — it's ON DELETE SET NULL). Manually delete members first
  // so they don't briefly orphan to ungrouped status.
  await supabase.from("action_templates").delete().eq("group_id", id);
  const { error } = await supabase
    .from("action_template_groups")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateActionSurfaces();
}

/**
 * Move a template into a group. Passing `groupId = null` is the "move to
 * its own new group" signal: a fresh solo group is created and the
 * template lands inside it (the UI never shows ungrouped templates). The
 * source group is auto-deleted if this move leaves it empty.
 */
export async function moveTemplateToGroup(
  templateId: string,
  groupId: string | null,
  sortOrder: number | null
) {
  if (!templateId) return;
  const supabase = await createSupabaseServerClient();
  const { data: src, error: srcErr } = await supabase
    .from("action_templates")
    .select("group_id")
    .eq("id", templateId)
    .maybeSingle();
  if (srcErr) throw new Error(srcErr.message);
  if (!src) return;
  const sourceGroupId = src.group_id ?? null;

  let targetGroupId = groupId;
  if (targetGroupId === null) {
    // "Drag to root" means "give this template its own solo group" — the UI
    // never displays ungrouped templates.
    const newSort = await nextTopLevelSortOrder(supabase);
    const { data: groupRow, error: groupErr } = await supabase
      .from("action_template_groups")
      .insert({ name: null, sort_order: newSort })
      .select("id")
      .single();
    if (groupErr) throw new Error(groupErr.message);
    targetGroupId = groupRow.id;
  }

  const payload: Record<string, unknown> = { group_id: targetGroupId };
  if (sortOrder !== null) payload.sort_order = sortOrder;
  const { error } = await supabase
    .from("action_templates")
    .update(payload)
    .eq("id", templateId);
  if (error) throw new Error(error.message);

  if (sourceGroupId && sourceGroupId !== targetGroupId) {
    await deleteGroupIfEmpty(supabase, sourceGroupId);
  }
  revalidateActionSurfaces();
}

/**
 * Renumber a sequence of templates (or groups) so their sort_orders are a
 * dense gap-of-1 sequence starting at `start`. Used by the admin editor
 * after every drag-commit to keep the merged top-level + per-group lists
 * stable across clients.
 */
export async function renumberActionContainer(
  kind: "template" | "group",
  orderedIds: string[],
  start = 0
) {
  if (orderedIds.length === 0) return;
  const supabase = await createSupabaseServerClient();
  const table = kind === "template" ? "action_templates" : "action_template_groups";
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from(table)
      .update({ sort_order: start + i })
      .eq("id", orderedIds[i]);
    if (error) throw new Error(error.message);
  }
  revalidateActionSurfaces();
}
