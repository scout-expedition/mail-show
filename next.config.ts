import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  // Permit 127.0.0.1 alongside localhost in dev so Playwright (which targets
  // 127.0.0.1) can issue server-action POSTs without being treated as
  // cross-origin. Production is unaffected.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
