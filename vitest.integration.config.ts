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
  },
});
