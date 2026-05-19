import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

// Unit tests: pure logic in src/lib and component tests colocated next to
// source. No DB, no network. Integration tests live in vitest.integration.config.ts.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  test: {
    // Default to node; component tests opt into jsdom with a top-of-file
    // `// @vitest-environment jsdom` comment (Vitest 4 dropped environmentMatchGlobs).
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [
      "node_modules",
      ".next",
      "tests/**",
      // Server-action tests need the integration harness; run via `pnpm test:int`.
      "src/app/**/*actions.test.ts",
      // Playwright owns its own runner + spec files.
      "tests/e2e/**",
    ],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Unit tests cover src/lib/** only; server actions live in
      // src/app/**/actions.ts and are exercised by vitest.integration.config.ts,
      // which keeps the unit-coverage denominator honest.
      include: ["src/lib/**/*.ts"],
      exclude: ["**/*.test.*", "**/types.ts"],
      // Regression ratchet — floors are set slightly below the measured
      // baseline (see docs/testing-inventory.md). The aim is "don't get worse",
      // not "hit a target". When coverage rises meaningfully, raise the floor
      // in the same PR. Per-glob ratchets pin the well-tested subdirectories
      // so a global average masking a regression in (say) lib/rules still
      // breaks CI.
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 53,
        lines: 60,
        "src/lib/rules/**": {
          statements: 88,
          branches: 85,
          functions: 95,
          lines: 95,
        },
        "src/lib/endings/**": {
          statements: 80,
          branches: 72,
          functions: 90,
          lines: 85,
        },
        "src/lib/db/**": {
          statements: 85,
          branches: 75,
          functions: 70,
          lines: 85,
        },
        "src/lib/auth/**": {
          statements: 90,
          branches: 80,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});
