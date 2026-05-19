"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeHex } from "@/lib/color";
import type { IconType } from "@/lib/db/enums";
import type { Nation } from "@/lib/db/types";

/**
 * Narrow per-field patch — called by useInstantField in NationsEditor.
 * Does NOT call revalidatePath; realtime fans out the change to other clients.
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
  const { error } = await supabase.from("nations").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createNation(): Promise<Nation> {
  const supabase = await createSupabaseServerClient();
  // Place the new row at the end of the existing sort_order so it doesn't
  // collide with an existing row that's currently selected/inspected.
  const { data: maxRow } = await supabase
    .from("nations")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = ((maxRow?.sort_order ?? -1) as number) + 1;
  const { data, error } = await supabase
    .from("nations")
    .insert({
      name: "New nation",
      color_hex: "#888888",
      sort_order: nextSortOrder,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Nation;
}

export async function updateAllNations(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const ids = formData.getAll("ids").map(String);
  const names = formData.getAll("names").map(String);
  const abbreviations = formData.getAll("abbreviations").map(String);
  const colors = formData.getAll("colors").map(String);
  const iconTypes = formData.getAll("icon_types").map(String);
  const iconValues = formData.getAll("icon_values").map(String);
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
      icon_type: (iconTypes[i] as IconType) || ("lucide" as IconType),
      icon_value: (iconValues[i] ?? "").trim() || null,
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
