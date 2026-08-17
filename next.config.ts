import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
    // Keep the `agentation` dev toolbar out of production bundles. The
    // NODE_ENV guard in the root layout only stops it rendering — the package
    // still gets bundled and shipped (~670KB) without this alias. See
    // src/lib/dev/agentation-stub.tsx.
    ...(process.env.NODE_ENV === "production"
      ? { resolveAlias: { agentation: "./src/lib/dev/agentation-stub.tsx" } }
      : {}),
  },
  // Permit 127.0.0.1 alongside localhost in dev so Playwright (which targets
  // 127.0.0.1) can issue server-action POSTs without being treated as
  // cross-origin. Production is unaffected.
  allowedDevOrigins: ["127.0.0.1"],
  // Hide the corner dev indicator that flickers between "rendering" and
  // "compiling" on each edit. Build/runtime errors still surface via the
  // dev-server overlay — only the activity badge is suppressed.
  devIndicators: false,
};

export default nextConfig;
