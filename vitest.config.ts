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
      "src/app/**/actions.test.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts", "src/app/**/actions.ts"],
      exclude: ["**/*.test.*", "**/types.ts"],
    },
  },
});
