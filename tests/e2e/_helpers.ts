import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

/**
 * Shared E2E test scaffolding — the admin client + a `__E2E__` marker for
 * seed/cleanup. Mirrors `tests/integration/_helpers.ts` but with its own
 * prefix so the two layers' rows can coexist in the local Supabase stack
 * without clobbering each other's cleanups.
 *
 * The `tests/e2e/auth.setup.ts` setup project mints a session via the
 * admin API once per run; spec files use `makeAdmin()` here to seed and
 * tear down their own data.
 */

const E2E_PREFIX = "__E2E__";

/** Service-role admin client against the local test stack. Bypasses RLS. */
export function makeAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "e2e helpers: SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY missing — run via scripts/test-e2e.sh."
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Prefix a string with the `__E2E__` marker so cleanupE2EData() can find it. */
export function e2eName(suffix: string): string {
  return `${E2E_PREFIX}${suffix}`;
}

/**
 * Delete every E2E-marked row this layer might have created. Cascades take
 * care of letter_groups → report_groups → letters → actions → report_segments,
 * and days → sorting_letters. Citizens / cities / nations are wiped wholesale
 * (none are E2E-relevant; the integration suite uses cleanupReferenceData for
 * those). Idempotent.
 */
export async function cleanupE2EData(sb: SupabaseClient): Promise<void> {
  await sb.from("playthroughs").delete().like("name", `${E2E_PREFIX}%`);
  await sb.from("storylines").delete().like("name", `${E2E_PREFIX}%`);
  await sb.from("days").delete().like("notes", `${E2E_PREFIX}%`);
}
