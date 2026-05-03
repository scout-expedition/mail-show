import { test, expect } from "@playwright/test";

/**
 * Authed smoke. The chromium project loads tests/e2e/.auth/storage.json
 * (written by auth.setup.ts), so /dashboard should render without bouncing
 * to /sign-in. Mostly proves the storageState wiring works — once that's
 * trusted, real specs can assume an authed session.
 */
test("authed user can load /dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page).not.toHaveURL(/\/sign-in/);
});
