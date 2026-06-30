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
    // Run the full Chrome-for-Testing build in new-headless mode rather than
    // the separate chrome-headless-shell binary. CI installs with `--no-shell`
    // (the headless-shell's CDN download hangs indefinitely), so the shell is
    // absent; `channel: "chromium"` makes Playwright drive the full browser
    // headless instead — which is exactly what `playwright install chromium
    // --no-shell` provides. Applies to both the setup and chromium projects.
    channel: "chromium",
  },
  projects: [
    // Signs in once via the Supabase admin API and writes
    // tests/e2e/.auth/storage.json. The chromium project depends on this
    // and reuses the cookies for every spec, so individual tests start
    // already authenticated.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/storage.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Local dev: an on-demand Turbopack server. CI: a prebuilt production
    // server — the CI workflow runs `next build` first, then `next start`
    // here. On-demand `next dev` compilation is flake-prone under E2E load.
    command: process.env.CI
      ? `next start -p ${E2E_PORT}`
      : `next dev --turbopack -p ${E2E_PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Map our SUPABASE_TEST_* vars into the names the app reads. `next dev`
      // reads NEXT_PUBLIC_* at process start; for `next start` they were
      // already baked by `next build` (the CI build step passes them) and
      // only SUPABASE_SERVICE_ROLE_KEY is needed at runtime — passing all
      // three is harmless in both modes.
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceKey,
    },
  },
});
