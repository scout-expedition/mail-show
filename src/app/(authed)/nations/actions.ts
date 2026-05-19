"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeHex } from "@/lib/color";
import type { IconType } from "@/lib/db/enums";

/**
 * Narrow per-field patch — called by useInstantField in NationsEditor.
 * Does NOT call revalidatePath; realtime fans out the change to other clients.
 *
 * `icon_type` / `icon_value` stay in the patch shape because the existing UI
 * binds icon inputs through here — but `nations` has no icon columns, so we
 * strip them before the DB write. (Adding the columns to `nations` is a
 * separate migration; until then those fields are accepted but ignored.)
 */
export async function patchNation(
  id: string,
  patch: Partial<{
    name: string;
    abbreviation: string | null;
    color_hex: string;
    icon_type: IconType;
    icon_value: string | null;
    sort_order: number;
  }>
) {
  const supabase = await createSupabaseServerClient();
  // Strip legacy icon fields the table doesn't have.
  const { icon_type: _it, icon_value: _iv, ...allowed } = patch;
  void _it;
  void _iv;
  const { error } = await supabase
    .from("nations")
    .update(allowed)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createNation() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("nations")
    .insert({ name: "New nation", color_hex: "#888888" });
  if (error) throw new Error(error.message);
  revalidatePath("/nations");
}

export async function updateAllNations(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const ids = formData.getAll("ids").map(String);
  const names = formData.getAll("names").map(String);
  const abbreviations = formData.getAll("abbreviations").map(String);
  const colors = formData.getAll("colors").map(String);
  const sortOrders = formData.getAll("sort_orders").map(String);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const name = (names[i] ?? "").trim();
    if (!name) continue;
    const payload = {
      name,
      abbreviation: (abbreviations[i] ?? "").trim() || null,
      color_hex: normalizeHex(colors[i] ?? "#888888"),
      sort_order: Number(sortOrders[i] ?? i),
    };
    const { error } = await supabase
      .from("nations")
      .update(payload)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/nations");
}

export async function deleteNation(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  if (updatedBy) {
    await supabase.from("nations").update({ updated_by: updatedBy }).eq("id", id);
  }
  const { error } = await supabase.from("nations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/nations");
}
