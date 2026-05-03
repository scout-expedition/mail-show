import { expect, test as setup } from "@playwright/test";
import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const STORAGE_PATH = "tests/e2e/.auth/storage.json";
const TEST_EMAIL = "playwright@e2e.test";

/**
 * Sign-in is magic-link only. Driving the email round-trip every spec is slow
 * and flaky, so we authenticate once via the Supabase admin API and persist
 * the resulting cookies as a Playwright storageState. Specs in the chromium
 * project pick this up automatically (see playwright.config.ts).
 *
 * Implementation notes:
 *   - `admin.generateLink` returns an implicit-flow URL (#access_token=…) by
 *     default, but the app's /auth/callback handler expects a PKCE ?code=…
 *     (because @supabase/ssr's signInWithOtp uses PKCE). So instead of
 *     following the link, we extract the email-OTP token from
 *     properties.hashed_token, exchange it via verifyOtp on a plain SSR
 *     client backed by an in-memory cookie jar, then forward whatever
 *     cookies @supabase/ssr wrote into Playwright's browser context.
 */
setup("authenticate", async ({ page }) => {
  const adminUrl = process.env.SUPABASE_TEST_URL;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
  if (!adminUrl || !serviceKey || !anonKey) {
    throw new Error(
      "auth.setup: SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY / SUPABASE_TEST_ANON_KEY missing — run via scripts/test-e2e.sh."
    );
  }

  const admin = createClient(adminUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Idempotent: if the user already exists from a prior run, swallow the
  // duplicate-email error. Anything else bubbles.
  const { error: createErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    email_confirm: true,
  });
  if (createErr && !/already.*registered|already.*exists/i.test(createErr.message)) {
    throw createErr;
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_EMAIL,
  });
  if (error) throw error;
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) {
    throw new Error("auth.setup: generateLink returned no hashed_token");
  }

  // Exchange the OTP for a session using an SSR-aware client. The cookie
  // adapter receives whatever cookies @supabase/ssr would normally write to
  // the response — that's the exact format the app reads on every request.
  const cookieJar: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const ssr = createServerClient(adminUrl, anonKey, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        cookieJar.push(...cookies);
      },
    },
  });
  const { error: verifyErr } = await ssr.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr) throw verifyErr;
  if (cookieJar.length === 0) {
    throw new Error("auth.setup: verifyOtp succeeded but wrote no cookies");
  }

  // Forward the auth cookies to Playwright. The app runs at 127.0.0.1:3010,
  // so scope cookies to that host. We deliberately drop the SSR cookie's
  // domain/path options (they target a Next response, not a browser jar)
  // and set ours.
  await page.context().addCookies(
    cookieJar.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    }))
  );

  // Sanity-check the session lands somewhere past the proxy.
  await page.goto("/dashboard");
  await expect(page).not.toHaveURL(/\/sign-in/);

  await page.context().storageState({ path: STORAGE_PATH });
});
