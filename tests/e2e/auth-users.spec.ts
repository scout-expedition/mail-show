import { test, expect } from "@playwright/test";
import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Coverage for the email/password + invite/delete auth flows. The
 * storageState chromium project signs in as `playwright@e2e.test` once
 * (see auth.setup.ts); these specs sometimes use that session for the
 * admin surface and sometimes drop it with `test.use({ storageState: ... })`
 * to drive the sign-in form anonymously.
 */

const STORAGE_USER = "playwright@e2e.test";

function makeAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("e2e: missing SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function deleteUserByEmail(admin: SupabaseClient, email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const found = data.users.find((u) => u.email === email);
  if (found) await admin.auth.admin.deleteUser(found.id);
}

/** Mint a session cookie for `email` and apply it to the Playwright context. */
async function signInAs(
  admin: SupabaseClient,
  context: import("@playwright/test").BrowserContext,
  email: string
) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed_token");

  const cookieJar: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const ssr = createServerClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: (cookies) => {
          cookieJar.push(...cookies);
        },
      },
    }
  );
  const { error: verifyErr } = await ssr.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr) throw verifyErr;

  await context.addCookies(
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
}

test.describe("password sign-in", () => {
  // No storageState — these tests drive the sign-in form anonymously.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("password happy path → /dashboard", async ({ page }) => {
    const admin = makeAdmin();
    const email = `pw-ok-${Date.now()}@e2e.test`;
    const password = "hunter22-strong";
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    try {
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page).not.toHaveURL(/\/sign-in/);
    } finally {
      await deleteUserByEmail(admin, email);
    }
  });

  test("password failure shows the generic error", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(`pw-bad-${Date.now()}@e2e.test`);
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText("Invalid email or password")).toBeVisible();
  });
});

test.describe("set-password flow", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("invited user can set a password and then sign in with it", async ({
    page,
    context,
  }) => {
    const admin = makeAdmin();
    const email = `invitee-${Date.now()}@e2e.test`;
    // Stand in for the post-invite state: user exists with no password.
    const { error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) throw error;

    try {
      // Drop a session for the invitee (same path the invite link grants).
      await signInAs(admin, context, email);
      await page.goto("/auth/set-password");
      const password = "fresh-password-1";
      await page.getByLabel("New password").fill(password);
      await page.getByLabel("Confirm password").fill(password);
      await page.getByRole("button", { name: "Save password" }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      // Sign out, then sign back in with the new password.
      await page.goto("/settings");
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/sign-in/);

      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/dashboard/);
    } finally {
      await deleteUserByEmail(admin, email);
    }
  });
});

test.describe("settings user management", () => {
  test("admin invites a user from /settings", async ({ page }) => {
    const admin = makeAdmin();
    const email = `invite-ui-${Date.now()}@e2e.test`;
    try {
      await page.goto("/settings");
      await page.getByPlaceholder("invitee@example.com").fill(email);
      await page.getByRole("button", { name: "Send invite" }).click();
      await expect(page.getByText(`Invite sent to ${email}`)).toBeVisible();

      // Verify Supabase actually created the user.
      const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
      expect(data.users.some((u) => u.email === email)).toBe(true);
    } finally {
      await deleteUserByEmail(admin, email);
    }
  });

  test("admin deletes a user from /settings", async ({ page }) => {
    const admin = makeAdmin();
    const email = `delete-target-${Date.now()}@e2e.test`;
    const { error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) throw error;

    try {
      await page.goto("/settings");
      const row = page.locator("li", { hasText: email });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Delete user" }).click();
      await expect(row).toHaveCount(0);

      const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
      expect(data.users.some((u) => u.email === email)).toBe(false);
    } finally {
      await deleteUserByEmail(admin, email);
    }
  });

  test("self-delete is blocked (no delete button on own row)", async ({ page }) => {
    await page.goto("/settings");
    const ownRow = page.locator("li", { hasText: STORAGE_USER });
    await expect(ownRow).toBeVisible();
    await expect(ownRow.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(ownRow.getByText("you")).toBeVisible();
  });
});
