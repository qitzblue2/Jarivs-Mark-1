import type { NextConfig } from "next";

/**
 * Response headers on every route.
 *
 * Only ones that cannot get in the way. A Content-Security-Policy would be
 * the strongest of the set, but Next injects inline scripts and the voice
 * pipeline loads WebAssembly and workers; a policy loose enough to work
 * protects little and one tight enough to matter breaks the app. The
 * cross-origin isolation headers are left alone for the same reason —
 * the ONNX runtime's threaded build depends on neither.
 *
 *   nosniff          a response is only ever treated as the type it says it is
 *   SAMEORIGIN       other sites can't put JARVIS in a frame to trick a click
 *   Referrer-Policy  a link out of JARVIS doesn't announce where you were
 *   Permissions      the microphone is this origin's alone; camera, location
 *                    and payments are never used, so they are never offered
 */
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
