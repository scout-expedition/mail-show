import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

// Integration tests: server actions, DB views, RLS. Run against a local
// Supabase stack (`supabase start`); see tests/integration/README.md and
// knowledge-base/testing/server-actions.md. Requires SUPABASE_TEST_URL and
// SUPABASE_TEST_SERVICE_KEY in env (scripts/test-int.sh sources them).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  test: {
    environment: "node",
    include: [
      "src/app/**/*actions.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    setupFiles: ["./tests/setup.integration.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Separate output dir so a unit + integration run side-by-side doesn't
      // clobber `./coverage`.
      reportsDirectory: "coverage-int",
      // Integration suite owns server-action coverage; src/lib/** belongs to
      // the unit config (vitest.config.ts).
      include: ["src/app/**/actions.ts"],
      exclude: ["**/*.test.*", "**/types.ts"],
      // Regression ratchet — floors are set slightly below the measured
      // baseline (see docs/testing-inventory.md). Two files drag the global
      // numbers down hard: auth/set-password and sign-in are 0% (need GoTrue
      // session manipulation we don't have a harness for), and the giant
      // inspection/letters/actions.ts is 13.5% (~2000 lines; the core flows
      // are covered but the long tail is not). The floor is global; tightening
      // individual files happens when they get more dedicated coverage.
      thresholds: {
        statements: 51,
        branches: 44,
        functions: 50,
        lines: 54,
      },
    },
  },
});
