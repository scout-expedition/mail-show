"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CitizenType } from "@/lib/db/enums";
import type { Citizen } from "@/lib/db/types";
import { splitName } from "@/lib/citizen-name";

/**
 * Narrow per-field patch — called by useInstantField in the citizen inspector.
 * Does NOT call revalidatePath; realtime fans out the change to other clients.
 */
export async function patchCitizen(
  id: string,
  patch: Partial<{
    first_name: string;
    last_name: string;
    middle_name: string | null;
    honorific: string | null;
    title: string | null;
    suffix: string | null;
    name_display_format: string | null;
    address_line: string | null;
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

/**
 * Insert a blank citizen and return the new row. No revalidatePath: the editor
 * inserts the row locally and pins it to the top of the list until the user
 * clicks away — a revalidate would re-sort it immediately.
 */
export async function createCitizen(): Promise<Citizen> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("citizens")
    .insert({
      type: "npc" as CitizenType,
      first_name: "",
      last_name: "",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Citizen;
}

/**
 * Parse a pasted block where each line is: "Type, Name, CitizenID, City".
 * Type = "hero" | "npc" (or blank, defaults to npc). The Name column is split
 * into first/last via the same rule as migration 0040.
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
    first_name: string;
    last_name: string;
    citizen_id: string | null;
    city_id: string | null;
    nation_id: string | null;
  };
  const rows: Row[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.split(/\t|,|\|/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const [typeRaw = "", name = "", citizenIdRaw = "", cityRaw = ""] = parts;
    const { first_name, last_name } = splitName(name);
    // Skip rows with no name at all (matches the old empty-name guard).
    if (!first_name && !last_name) continue;
    const typeLow = typeRaw.toLowerCase();
    const type: CitizenType = typeLow === "hero" ? "hero" : "npc";
    const city = cityRaw ? cityByName.get(cityRaw.toLowerCase()) : undefined;
    rows.push({
      type,
      first_name,
      last_name,
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
