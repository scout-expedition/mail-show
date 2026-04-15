import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Supabase client for Server Components and Server Actions. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local"
    );
  }
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — cookies() is read-only there.
          // The middleware will refresh the session on the next request.
        }
      },
    },
  });
}

/** Service-role client for admin tasks (never expose to the browser). */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Service-role env not configured: set SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  // createServerClient with a service-role key bypasses RLS.
  return createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
