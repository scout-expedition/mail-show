import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
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
