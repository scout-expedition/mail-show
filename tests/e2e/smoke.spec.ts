import { test, expect } from "@playwright/test";

// Foundational smoke. Proves the Playwright + dev-server pipeline works:
// the test env wires through, the proxy redirects unauthenticated requests
// to /sign-in, and the page renders. Real auth-required flows live in the
// other specs in this directory.

test("unauthenticated visit to / should redirect to /sign-in and render the page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  // The sign-in page should at minimum render an input for the user to
  // start a session. If the dev server failed to boot or the proxy chain
  // is broken, this assertion catches it.
  await expect(page.getByRole("textbox").first()).toBeVisible();
});
