import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Static security headers. The Content-Security-Policy is set per request in
// src/proxy.ts because it carries a nonce.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // Server actions carry private push subscription keys and credentials.
  logging: { serverFunctions: false },
  // Emit a self-contained server (.next/standalone) for the production image.
  output: "standalone",
  poweredByHeader: false,
  async rewrites() { return [{source:"/api/live/bots/:id",destination:`${process.env.API_URL || "http://localhost:8080"}/api/live/bots/:id`}]; },
  async headers() {
    // Skip next dev's development manifests, which it serves with a JSON content type.
    return [{ source: "/((?!_next/static/development/).*)", headers: securityHeaders }, { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
};

export default nextConfig;
