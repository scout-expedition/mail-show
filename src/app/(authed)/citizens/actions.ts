"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CitizenType } from "@/lib/db/enums";

/**
 * Narrow per-field patch — called by useInstantField in CitizensEditor.
 * Does NOT call revalidatePath; realtime fans out the change to other clients.
 */
export async function patchCitizen(
  id: string,
  patch: Partial<{
    name: string;
    type: CitizenType;
    citizen_id: string | null;
    city_id: string | null;
    nation_id: string | null;
  }>
) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("citizens").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

function nilOrString(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function createCitizen() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("citizens")
    .insert({ name: "New citizen", type: "npc" as CitizenType });
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
}

export async function updateAllCitizens(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const ids = formData.getAll("ids").map(String);
  const names = formData.getAll("names").map(String);
  const types = formData.getAll("types").map(String);
  const citizenIds = formData.getAll("citizen_ids").map(String);
  const cityIds = formData.getAll("city_ids").map(String);
  const nationIds = formData.getAll("nation_ids").map(String);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const rawType = (types[i] ?? "").trim();
    if (rawType !== "hero" && rawType !== "npc") continue;
    const payload = {
      name: (names[i] ?? "").trim(),
      type: rawType as CitizenType,
      citizen_id: ((citizenIds[i] ?? "").trim() || null) as string | null,
      city_id: ((cityIds[i] ?? "").trim() || null) as string | null,
      nation_id: ((nationIds[i] ?? "").trim() || null) as string | null,
    };
    if (!payload.name) continue;
    if (
      payload.type === "npc" &&
      (!payload.citizen_id || !payload.city_id || !payload.nation_id)
    ) {
      continue;
    }
    const { error } = await supabase
      .from("citizens")
      .update(payload)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/citizens");
}

/**
 * Parse a pasted block where each line is: "Type, Name, CitizenID, City".
 * Type = "hero" | "npc" (or blank, defaults to npc).
 * City matches by name (case-insensitive). Nation is auto-filled from the city.
 * Tab / comma / pipe separated. Invalid lines are skipped.
 */
export async function bulkCreateCitizens(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const raw = String(formData.get("paste") ?? "").trim();
  if (!raw) return;

  const { data: cityData } = await supabase
    .from("cities")
    .select("id, name, nation_id");
  const cityByName = new Map<string, { id: string; nation_id: string }>();
  for (const c of cityData ?? [])
    cityByName.set(String(c.name).toLowerCase(), {
      id: c.id as string,
      nation_id: c.nation_id as string,
    });

  type Row = {
    type: CitizenType;
    name: string;
    citizen_id: string | null;
    city_id: string | null;
    nation_id: string | null;
  };
  const rows: Row[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const parts = line
      .split(/\t|,|\|/)
      .map((s) => s.trim());
    if (parts.length < 2) continue;
    const [typeRaw = "", name = "", citizenIdRaw = "", cityRaw = ""] = parts;
    if (!name) continue;
    const typeLow = typeRaw.toLowerCase();
    const type: CitizenType = typeLow === "hero" ? "hero" : "npc";
    const city = cityRaw ? cityByName.get(cityRaw.toLowerCase()) : undefined;
    rows.push({
      type,
      name,
      citizen_id: citizenIdRaw || null,
      city_id: city?.id ?? null,
      nation_id: city?.nation_id ?? null,
    });
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from("citizens").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
}

export async function deleteCitizen(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("citizens").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
}
