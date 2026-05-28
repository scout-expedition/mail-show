"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Upserts the singleton `playthrough_reference_settings` row.
 *
 * Singleton strategy: we query for any existing row first, then UPDATE or
 * INSERT accordingly. This avoids hard-coding a deterministic UUID while still
 * guaranteeing at most one row exists. (The table has no uniqueness constraint
 * beyond the PK, so we enforce the singleton purely in application logic here.)
 */
export async function setPlaythroughReferenceMap(
  url: string | null
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // Check for an existing row.
  const { data: existing, error: selectError } = await supabase
    .from("playthrough_reference_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (selectError) {
    throw new Error(
      `Failed to read playthrough reference settings: ${selectError.message}`
    );
  }

  if (existing) {
    // Row exists — update in place.
    const { error } = await supabase
      .from("playthrough_reference_settings")
      .update({ map_image_url: url, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) {
      throw new Error(
        `Failed to update playthrough reference settings: ${error.message}`
      );
    }
  } else {
    // No row yet — insert the first one.
    const { error } = await supabase
      .from("playthrough_reference_settings")
      .insert({ map_image_url: url });
    if (error) {
      throw new Error(
        `Failed to insert playthrough reference settings: ${error.message}`
      );
    }
  }

  revalidatePath("/settings");
  // Bracket form so Next revalidates every /playthroughs/[id] page.
  revalidatePath("/playthroughs/[id]", "page");
}
