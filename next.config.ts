import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * `unsafe-inline` is required for styles because Next.js injects a runtime
 * stylesheet tag, and Tailwind's preflight is inlined. Scripts stay strict —
 * `'unsafe-eval'` is deliberately NOT granted, which matters because this app
 * bundles `@solana/web3.js` for wallet signing.
 *
 * `connect-src` must permit the Solana cluster: the browser talks to Devnet RPC
 * directly when the user anchors through their own wallet. No provider
 * credential is ever placed here.
 */
const csp = [
  "default-src 'self'",
  // Next.js emits an inline bootstrap script for hydration.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // next/image optimisation serves media from this origin.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Wallet injection reads `window.*`; connect covers Devnet RPC and OSV/registry
  // calls the server makes on the agent's behalf (server-side, but harmless to
  // allow for tooling).
  "connect-src 'self' https://api.devnet.solana.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  /**
   * Baseline security headers for a publicly reachable deployment.
   *
   * `Strict-Transport-Security` is omitted deliberately: this build is often run
   * on plain HTTP for a local demo, and shipping an HSTS header there would pin
   * the host to HTTPS and break it. Add it at the reverse proxy once the
   * deployment actually terminates TLS.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;