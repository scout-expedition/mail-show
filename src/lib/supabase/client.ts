"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/**
 * Singleton Supabase client for Client Components.
 *
 * Returning the SAME instance across calls preserves auth state so the
 * embedded realtime client keeps the JWT attached. Creating a fresh client
 * per call resets the realtime client's `accessToken` (and so RLS-gated
 * `postgres_changes` subscriptions are silently denied while broadcasts
 * still work — the classic "I see the focus ring but content doesn't
 * propagate" signature).
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  }
  browserClient = createBrowserClient(url, key);
  return browserClient;
}
