/**
 * Password auth for a JARVIS that is reachable from outside the machine.
 *
 * Deliberately minimal — one shared password, one signed cookie, no user
 * accounts. This is a personal assistant, not a SaaS. What matters is that a
 * JARVIS exposed through a tunnel, with filesystem and shell tools available,
 * cannot be driven by whoever finds the URL.
 *
 * Uses Web Crypto so it works in Next middleware (edge runtime) as well as
 * in route handlers.
 */

const COOKIE = "jarvis_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export { COOKIE as SESSION_COOKIE };

function configuredPassword(): string | null {
  const value = process.env.JARVIS_PASSWORD;
  return value && value.length > 0 ? value : null;
}

export function authConfigured(): boolean {
  return configuredPassword() !== null;
}

function encoder() {
  return new TextEncoder();
}

async function key(): Promise<CryptoKey> {
  // The password doubles as the signing secret: if it changes, every existing
  // session is invalidated, which is the behaviour you want.
  const secret = configuredPassword() ?? "unconfigured";
  return crypto.subtle.importKey(
    "raw",
    encoder().encode(`jarvis-session:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Signed token carrying only its own expiry. */
export async function createToken(): Promise<string> {
  const payload = String(Date.now() + TTL_MS);
  const signature = await crypto.subtle.sign("HMAC", await key(), encoder().encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const split = token.lastIndexOf(".");
  if (split <= 0) return false;

  const payload = token.slice(0, split);
  const provided = token.slice(split + 1);

  const expected = toBase64Url(
    await crypto.subtle.sign("HMAC", await key(), encoder().encode(payload)),
  );

  // Constant-time-ish compare; lengths are fixed here so a length check is fine.
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;

  const expiry = Number(payload);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/** Compare a submitted password without leaking length via early exit. */
export function passwordMatches(submitted: string): boolean {
  const actual = configuredPassword();
  if (!actual) return false;
  if (submitted.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= submitted.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

/**
 * Whether the server is listening beyond loopback.
 *
 * This is the real security boundary, and it is deliberately NOT derived from
 * request headers: both `Host` and `X-Forwarded-For` are set by the client
 * and pass straight through, so a LAN device can claim `Host: localhost` and
 * `X-Forwarded-For: 127.0.0.1`. Any "is this local?" check built on headers
 * is bypassable.
 *
 * Instead the npm scripts that widen the bind set JARVIS_OPEN_NETWORK=1. With
 * the default loopback-only bind, nothing off-machine can connect at all, so
 * skipping the password for local use is safe. Widen the bind and a password
 * becomes mandatory.
 */
export function openNetwork(): boolean {
  return process.env.JARVIS_OPEN_NETWORK === "1";
}

/** True when the Host header names loopback. Never sufficient on its own. */
export function hostIsLoopback(host: string | null): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

/**
 * Does this request need a password?
 *
 * Auth is required whenever the server is reachable off-machine, and whenever
 * the request is addressed to anything other than loopback — which is how
 * tunnel traffic is caught, since a tunnel rewrites Host to its own hostname.
 */
export function requiresAuth(host: string | null): boolean {
  return openNetwork() || !hostIsLoopback(host);
}

export function cookieOptions(secure: boolean) {
  return {
    name: COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: TTL_MS / 1000,
  };
}
