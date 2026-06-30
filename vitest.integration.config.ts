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
      // baseline (see docs/testing-inventory.md). auth/set-password and
      // sign-in remain 0% (need GoTrue session manipulation we don't have a
      // harness for). The giant inspection/letters/actions.ts and the new
      // endings/smart-variables/actions.ts got dedicated piece-group /
      // smart-variable coverage, lifting the global baseline to
      // 59.25 / 49.94 / 60.62 / 64.13 — floors raised to lock that in.
      thresholds: {
        statements: 57,
        branches: 47,
        functions: 58,
        lines: 62,
      },
    },
  },
});
