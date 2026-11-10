import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Every provider call goes through this app's own route handlers, so the
 * browser only ever talks to 'self'. Wallet extensions run outside page CSP.
 * 'wasm-unsafe-eval' is required by the Poseidon hasher the privacy SDK loads.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Distinct build dirs let the QA servers (fixture-backed) run beside `next dev`.
  distDir: process.env.NOCT_DIST_DIR || ".next",
  turbopack: {
    // @lightprotocol/hasher.rs "browser-fat" embeds its WASM as base64; the
    // `new URL(*.wasm, import.meta.url)` fallback is never fetched but must resolve.
    resolveAlias: {
      "light_wasm_hasher_bg.wasm": "./node_modules/@lightprotocol/hasher.rs/dist/light_wasm_hasher_bg.wasm",
      "hasher_wasm_simd_bg.wasm": "./node_modules/@lightprotocol/hasher.rs/dist/hasher_wasm_simd_bg.wasm",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Private screens must never be cached by intermediaries.
        source: "/api/((?!token-icon).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
