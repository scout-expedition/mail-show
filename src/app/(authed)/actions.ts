"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NAV_ITEMS } from "@/lib/nav-items";

const VALID_PATHS = new Set(NAV_ITEMS.map((item) => item.href));
const MAX_TILES = 48;

function pathnameOf(raw: string): string {
  const noHash = raw.split("#")[0] ?? "";
  return noHash.split("?")[0] ?? "";
}

export async function setUserHomeTiles(hrefs: string[]): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (userErr || !userId) throw new Error("Not authenticated");

  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of hrefs) {
    if (typeof raw !== "string") continue;
    if (!raw.startsWith("/")) continue;
    if (!VALID_PATHS.has(pathnameOf(raw))) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    clean.push(raw);
    if (clean.length >= MAX_TILES) break;
  }

  const { error } = await supabase
    .from("user_home_tiles")
    .upsert({ user_id: userId, tile_hrefs: clean }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);

  revalidatePath("/");
}
