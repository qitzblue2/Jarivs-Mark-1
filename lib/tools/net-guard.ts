import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF protection for `fetch_url`.
 *
 * A language model chooses the URL and this server makes the request — with
 * provider API keys sitting in the same process environment. Without a guard
 * that is a confused-deputy hole: "fetch http://169.254.169.254/..." would
 * hand over cloud credentials, and "http://localhost:3000/api/chats" would
 * read the user's private conversations.
 */

export const MAX_BYTES = 2_000_000;
export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 12_000;

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** Parse an IPv4 dotted quad into its 32-bit value, or null. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/**
 * True for any address that must never be reachable from a model-chosen URL:
 * loopback, RFC1918 private space, link-local (which covers the cloud
 * metadata endpoint at 169.254.169.254), CGNAT, multicast and reserved ranges.
 */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const value = ipv4ToInt(ip);
    if (value === null) return true;
    const inRange = (cidr: string, bits: number) => {
      const base = ipv4ToInt(cidr)!;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === (base & mask) >>> 0;
    };
    return (
      inRange("0.0.0.0", 8) ||        // "this network"
      inRange("10.0.0.0", 8) ||       // private
      inRange("100.64.0.0", 10) ||    // CGNAT
      inRange("127.0.0.0", 8) ||      // loopback
      inRange("169.254.0.0", 16) ||   // link-local — cloud metadata lives here
      inRange("172.16.0.0", 12) ||    // private
      inRange("192.0.0.0", 24) ||     // IETF protocol assignments
      inRange("192.168.0.0", 16) ||   // private
      inRange("198.18.0.0", 15) ||    // benchmarking
      inRange("224.0.0.0", 4) ||      // multicast
      inRange("240.0.0.0", 4)         // reserved / broadcast
    );
  }

  if (version === 6) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (lower === "::" || lower === "::1") return true;
    // IPv4-mapped (::ffff:10.0.0.1) must be judged on the embedded v4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isBlockedAddress(mapped[1]);
    return (
      lower.startsWith("fe80") || // link-local
      lower.startsWith("fc") ||   // unique local
      lower.startsWith("fd") ||   // unique local
      lower.startsWith("ff")      // multicast
    );
  }

  // Not a literal IP — caller resolves the hostname first.
  return true;
}

/** Validate one URL: scheme, hostname shape, and every resolved address. */
export async function assertUrlAllowed(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError(`Not a valid URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Only http and https are allowed, not "${url.protocol}"`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  // Literal IPs skip DNS but still get checked.
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new BlockedUrlError(`Blocked address: ${hostname} is not publicly routable`);
    }
    return url;
  }

  if (/^localhost$/i.test(hostname) || /\.(local|internal|localhost)$/i.test(hostname)) {
    throw new BlockedUrlError(`Blocked host: ${hostname}`);
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedUrlError(`Could not resolve host: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new BlockedUrlError(`Host resolved to nothing: ${hostname}`);
  }

  // Every answer must be safe — one private address in a round-robin is enough
  // to reach an internal service.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedUrlError(
        `Blocked host: ${hostname} resolves to ${address}, which is not publicly routable`,
      );
    }
  }

  return url;
}

/**
 * Fetch a URL with the guard applied to every redirect hop.
 *
 * Redirects are followed manually because a public host answering 302 with a
 * `Location` of http://169.254.169.254/ is the standard way past a check that
 * only validates the original URL.
 */
export async function guardedFetch(
  raw: string,
  init: RequestInit = {},
): Promise<{ response: Response; finalUrl: string }> {
  let target = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertUrlAllowed(target);

    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "JARVIS/3 (+https://github.com/qitzblue2)",
        ...(init.headers ?? {}),
      },
    });

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get("location");

    if (!isRedirect || !location) return { response, finalUrl: url.toString() };

    // Consume the body so the socket is released before the next hop.
    await response.arrayBuffer().catch(() => {});
    target = new URL(location, url).toString();
  }

  throw new BlockedUrlError(`Too many redirects (more than ${MAX_REDIRECTS})`);
}

/** Read a response body as text, refusing to buffer more than MAX_BYTES. */
export async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    throw new BlockedUrlError(`Response too large (${declared} bytes)`);
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total > MAX_BYTES ? MAX_BYTES : total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset + chunk.length > merged.length) {
      merged.set(chunk.subarray(0, merged.length - offset), offset);
      break;
    }
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}
