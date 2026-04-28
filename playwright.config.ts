import { defineConfig, devices } from "@playwright/test";

// E2E config. The dev server boots on a dedicated port pointed at the local
// Supabase stack (not the cloud project). Required env vars come from
// .env.test.local via scripts/test-e2e.sh.

const E2E_PORT = 3010;
const baseURL = `http://127.0.0.1:${E2E_PORT}`;

const supabaseUrl = process.env.SUPABASE_TEST_URL;
const supabaseAnonKey = process.env.SUPABASE_TEST_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_TEST_SERVICE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  throw new Error(
    "playwright: missing SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY / SUPABASE_TEST_SERVICE_KEY (run via scripts/test-e2e.sh; see tests/integration/README.md)."
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  // E2E specs only — vitest owns everything else.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Map our SUPABASE_TEST_* vars into the names the app reads. Next bakes
    // NEXT_PUBLIC_* at process start, so this must be set before `next dev`
    // launches.
    command: `next dev --turbopack -p ${E2E_PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceKey,
      // E2E test users live under @e2e.test; the proxy + allowlist will
      // gate sign-in to that domain only.
      ALLOWED_EMAIL_DOMAINS: "e2e.test",
    },
  },
});
