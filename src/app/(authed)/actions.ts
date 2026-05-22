"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NAV_ITEMS } from "@/lib/nav-items";

const VALID_PATHS = new Set(NAV_ITEMS.map((item) => item.href));
const MAX_TILES = 48;

/** Pathnames that support a single approved query-string deep-link key.
 *  Any other query/hash on any other path is stripped, so attackers can't
 *  fork duplicate tiles by appending arbitrary query strings. */
const SUB_PARAM_BY_PATH: Record<string, string> = {
  "/top-of-day/morning-reports": "day",
  "/endings/frameworks": "framework",
  "/endings/logic": "tab",
};

const SAFE_SUB_VALUE = /^[A-Za-z0-9_\-.~]{1,200}$/;

/** Normalize an href: keep only the pathname for paths without sub-options;
 *  keep `?<knownKey>=<safeValue>` for paths that do. Reject anything else. */
function normalizeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/")) return null;
  const noHash = raw.split("#")[0] ?? "";
  const [pathname, query] = noHash.split("?");
  if (!pathname || !VALID_PATHS.has(pathname)) return null;
  if (!query) return pathname;
  const subKey = SUB_PARAM_BY_PATH[pathname];
  if (!subKey) return pathname;
  const params = new URLSearchParams(query);
  // Allow only the single known sub-key, nothing else.
  if (params.size !== 1) return pathname;
  const value = params.get(subKey);
  if (!value || !SAFE_SUB_VALUE.test(value)) return pathname;
  return `${pathname}?${subKey}=${value}`;
}

export async function setUserHomeTiles(hrefs: string[]): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (userErr || !userId) throw new Error("Not authenticated");

  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of hrefs) {
    const normalized = normalizeHref(raw);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    clean.push(normalized);
    if (clean.length >= MAX_TILES) break;
  }

  const { error } = await supabase
    .from("user_home_tiles")
    .upsert({ user_id: userId, tile_hrefs: clean }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);

  revalidatePath("/");
}
