"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { IconType } from "@/lib/db/enums";
import { normalizeHex } from "@/lib/color";

type StorylinePatchFields = {
  name: string;
  abbreviation: string;
  description: string | null;
  icon_type: IconType;
  icon_value: string | null;
  color_hex: string;
};

function assertAbbreviationAllowed(abbreviation: string) {
  if (abbreviation.toUpperCase() === "D") {
    throw new Error(
      'Abbreviation "D" is reserved — it collides with day identifiers (D1, D2…).'
    );
  }
}

/**
 * Narrow per-field patch used by instant-save hooks on the storyline inspector
 * and standalone editor. Does NOT call revalidatePath — realtime fans out
 * changes to other clients. Structural mutations (create/delete/reorder) still
 * call revalidatePath as before.
 */
export async function patchStoryline(
  id: string,
  patch: Partial<StorylinePatchFields>
) {
  if (patch.abbreviation !== undefined) {
    assertAbbreviationAllowed(patch.abbreviation);
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("storylines").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

function nilStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Create a storyline from explicit fields — used by the "+ Storyline"
 * modal on /inspection/storylines. Does not redirect so the dialog can
 * close cleanly and the list refresh via revalidatePath.
 */
export async function createStorylineWithFields(data: {
  name: string;
  abbreviation: string;
  description: string | null;
  icon_type: IconType;
  icon_value: string | null;
  color_hex: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const normalizedAbbr =
    data.abbreviation.trim().toUpperCase().charAt(0) || "X";
  assertAbbreviationAllowed(normalizedAbbr);
  const payload = {
    name: data.name.trim() || "New storyline",
    abbreviation: normalizedAbbr,
    description: data.description?.trim() || null,
    icon_type: data.icon_type,
    icon_value: data.icon_value?.trim() || null,
    color_hex: normalizeHex(data.color_hex),
  };
  const { data: row, error } = await supabase
    .from("storylines")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/storylines");
  revalidatePath("/inspection/letters");
  return { id: row!.id as string };
}

export async function createStoryline() {
  const supabase = await createSupabaseServerClient();
  // Pick the next unused single uppercase letter A-Z; fall back to "X".
  const { data: existing } = await supabase
    .from("storylines")
    .select("abbreviation");
  const used = new Set(
    (existing ?? []).map((s) => (s.abbreviation ?? "").toUpperCase())
  );
  let abbr = "X";
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    if (letter === "D") continue;
    if (!used.has(letter)) {
      abbr = letter;
      break;
    }
  }
  const { data, error } = await supabase
    .from("storylines")
    .insert({
      name: "New storyline",
      abbreviation: abbr,
      icon_type: "lucide" as IconType,
      color_hex: "#4b8eff",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/storylines");
  redirect(`/inspection/storylines/${data!.id}`);
}

/**
 * Plain-object update used by the inline StorylineInspector on
 * /inspection/letters. The original `updateStoryline` below still accepts
 * a FormData for use with the storylines editor page.
 */
export async function updateStorylineFields(data: {
  id: string;
  name: string;
  abbreviation: string;
  description: string | null;
  icon_type: IconType;
  icon_value: string | null;
  color_hex: string;
}) {
  const supabase = await createSupabaseServerClient();
  const normalizedAbbr =
    data.abbreviation.trim().toUpperCase().charAt(0) || "X";
  assertAbbreviationAllowed(normalizedAbbr);
  const payload = {
    name: data.name.trim(),
    abbreviation: normalizedAbbr,
    description: data.description?.trim() || null,
    icon_type: data.icon_type,
    icon_value: data.icon_value?.trim() || null,
    color_hex: normalizeHex(data.color_hex),
  };
  const { error } = await supabase
    .from("storylines")
    .update(payload)
    .eq("id", data.id);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters");
  revalidatePath(`/inspection/storylines/${data.id}`);
  revalidatePath("/inspection/storylines");
}

export async function updateStoryline(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const normalizedAbbr = String(formData.get("abbreviation") ?? "")
    .trim()
    .toUpperCase()
    .charAt(0);
  assertAbbreviationAllowed(normalizedAbbr);
  const payload = {
    name: String(formData.get("name") ?? "").trim(),
    abbreviation: normalizedAbbr,
    description: nilStr(formData.get("description")),
    icon_type: String(formData.get("icon_type") ?? "lucide") as IconType,
    icon_value: nilStr(formData.get("icon_value")),
    color_hex: normalizeHex(String(formData.get("color_hex") ?? "#888888")),
    sort_order: Number(formData.get("sort_order") ?? 0),
  };
  const { error } = await supabase.from("storylines").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/inspection/storylines/${id}`);
  revalidatePath("/inspection/storylines");
}

export async function deleteStoryline(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("storylines").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/storylines");
}

/**
 * Persist a new sort order for storylines. Receives an array of ids in the
 * desired display order; writes `sort_order = index` for each. Structural
 * mutation — keeps revalidatePath so the RSC layer resyncs display order.
 */
export async function reorderStorylines(ids: string[]) {
  const supabase = await createSupabaseServerClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from("storylines")
      .update({ sort_order: i })
      .eq("id", ids[i]);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/inspection/storylines");
}

export async function updateAllStorylines(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const ids = formData.getAll("ids").map(String);
  const names = formData.getAll("names").map(String);
  const abbrs = formData.getAll("abbreviations").map(String);
  const descriptions = formData.getAll("descriptions").map(String);
  const iconTypes = formData.getAll("icon_types").map(String);
  const iconValues = formData.getAll("icon_values").map(String);
  const colors = formData.getAll("colors").map(String);
  const sortOrders = formData.getAll("sort_orders").map(String);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const name = (names[i] ?? "").trim();
    if (!name) continue;
    const normalizedAbbr =
      (abbrs[i] ?? "").trim().toUpperCase().charAt(0) || "X";
    assertAbbreviationAllowed(normalizedAbbr);
    const payload = {
      name,
      abbreviation: normalizedAbbr,
      description: (descriptions[i] ?? "").trim() || null,
      icon_type: ((iconTypes[i] as IconType) ?? "lucide") as IconType,
      icon_value: (iconValues[i] ?? "").trim() || null,
      color_hex: normalizeHex(colors[i] ?? "#888888"),
      sort_order: Number(sortOrders[i] ?? i),
    };
    const { error } = await supabase
      .from("storylines")
      .update(payload)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/inspection/storylines");
}

export async function createLetterGroup(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const storyline_id = String(formData.get("storyline_id") ?? "");
  if (!storyline_id) return;
  const { data: existing } = await supabase
    .from("letter_groups")
    .select("sequence, sort_order")
    .eq("storyline_id", storyline_id);
  const nextSeq =
    Math.max(0, ...((existing ?? []).map((g) => Number(g.sequence ?? 0)))) + 1;
  const nextSort =
    Math.max(0, ...((existing ?? []).map((g) => Number(g.sort_order ?? 0)))) +
    1;
  const { error } = await supabase
    .from("letter_groups")
    .insert({
      storyline_id,
      name: `Group ${nextSeq}`,
      sequence: nextSeq,
      sort_order: nextSort,
    });
  if (error) throw new Error(error.message);
  const { data: storyline } = await supabase
    .from("storylines")
    .select("abbreviation")
    .eq("id", storyline_id)
    .maybeSingle();
  const abbr = storyline?.abbreviation ?? "";
  revalidatePath(`/inspection/storylines/${storyline_id}`);
  revalidatePath("/inspection/letters");
  redirect(`/inspection/letters?group=${abbr}${nextSeq}`);
}

export async function updateLetterGroup(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  if (!id) return;
  // `sequence` is intentionally NOT updated here — the display ID is changed
  // only through the Edit-ID popup (applyLetterGroupSequences).
  const payload = {
    name: String(formData.get("name") ?? "").trim(),
    notes: nilStr(formData.get("notes")),
    delivery_day_id: nilStr(formData.get("delivery_day_id")),
  };
  const { error } = await supabase.from("letter_groups").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  // Also mirror the name onto the linked report group (keeps them in sync by default).
  await supabase
    .from("report_groups")
    .update({ name: payload.name })
    .eq("letter_group_id", id);
  revalidatePath(`/inspection/storylines/${storyline_id}/groups/${id}`);
  revalidatePath(`/inspection/storylines/${storyline_id}`);
}

export async function deleteLetterGroup(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("letter_groups").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect(`/inspection/storylines/${storyline_id}`);
}
