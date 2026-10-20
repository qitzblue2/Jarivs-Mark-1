import type { ModelInfo } from "./types";

/**
 * Two small caches that exist to stop JARVIS spending your free tier on
 * nothing.
 *
 * A free tier is metered in requests, and JARVIS was making them for reasons
 * that have nothing to do with answering a question. Every page load asked
 * every configured provider for its model list — five providers meant five
 * upstream requests per refresh — and every fallback attempt asked again
 * before it even tried to chat. On OpenRouter's 50-requests-a-day tier, ten
 * page refreshes exhausted the whole day without a word being said.
 *
 * Both caches are per-process and deliberately unbounded in nothing but time:
 * a handful of providers means a handful of entries.
 */

/** Model lists change on the order of weeks; ten minutes is plenty fresh. */
const MODELS_TTL_MS = 10 * 60_000;
/**
 * A failure is cached far more briefly. Long enough that a server which is
 * switched off isn't hammered on every render, short enough that starting it
 * up shows results almost immediately.
 */
const FAILURE_TTL_MS = 20_000;

interface Entry {
  at: number;
  models?: ModelInfo[];
  error?: Error;
}

const models = new Map<string, Entry>();

/**
 * Identify a cache slot without storing the key.
 *
 * The key is part of the identity — changing it must refetch, since a
 * different key can see different models — but caching under the key itself
 * would put credentials in a long-lived map for no reason. A short digest is
 * enough to notice a change.
 */
function slot(providerId: string, baseUrl: string, key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return `${providerId}@${baseUrl}#${hash}`;
}

/**
 * Serve a model list from cache, or fetch and remember it.
 *
 * `force` is for the Test button in Settings, which exists precisely to
 * answer "is it reachable right now" and would be worthless cached.
 */
export async function cachedModels(
  providerId: string,
  baseUrl: string,
  key: string,
  fetcher: () => Promise<ModelInfo[]>,
  force = false,
): Promise<ModelInfo[]> {
  const id = slot(providerId, baseUrl, key);
  const hit = models.get(id);
  const age = hit ? Date.now() - hit.at : Infinity;

  if (!force && hit) {
    if (hit.models && age < MODELS_TTL_MS) {
      stats.hits++;
      return hit.models;
    }
    // A remembered failure is re-thrown rather than retried, so a provider
    // that is down costs one request per 20 seconds instead of one per render.
    if (hit.error && age < FAILURE_TTL_MS) throw hit.error;
  }

  stats.misses++;
  try {
    const fresh = await fetcher();
    models.set(id, { at: Date.now(), models: fresh });
    return fresh;
  } catch (err) {
    models.set(id, { at: Date.now(), error: err as Error });
    throw err;
  }
}

/**
 * Upstream calls avoided, and made. Surfaced by /api/models so "is the cache
 * working" is a number rather than a belief.
 */
export const stats = { hits: 0, misses: 0 };

/** Drop everything. Used by tests; nothing in the app needs it. */
export function clearModelCache(): void {
  models.clear();
  stats.hits = 0;
  stats.misses = 0;
}


/**
 * Remembering that a provider just said no.
 *
 * Without this the fallback chain retries a rate-limited provider on every
 * subsequent turn, spending a request to be told no again — and on a tier
 * metered in requests, being refused costs exactly as much as being answered.
 * It also puts the slowest possible path first: a guaranteed failure before
 * the provider that would have worked.
 */
const cooling = new Map<string, number>();

/** Default backoff when the provider doesn't say how long to wait. */
const DEFAULT_COOLDOWN_MS = 60_000;

export function markRateLimited(providerId: string, retryAfterMs?: number): void {
  const wait = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : DEFAULT_COOLDOWN_MS;
  // Capped: a provider reporting "retry in 24 hours" should not remove itself
  // from the app until tomorrow, because daily quotas reset on their clock,
  // not ours, and being wrong in this direction costs one wasted request.
  cooling.set(providerId, Date.now() + Math.min(wait, 15 * 60_000));
}

/** Milliseconds until this provider is worth trying again; 0 if it is now. */
export function cooldownRemaining(providerId: string): number {
  const until = cooling.get(providerId);
  if (!until) return 0;
  const left = until - Date.now();
  if (left <= 0) {
    cooling.delete(providerId);
    return 0;
  }
  return left;
}

/**
 * Drop cooling providers from an ordered list — unless that would empty it.
 *
 * Refusing to try anything is worse than trying something likely to fail: the
 * limit may have reset early, and an error from a real attempt is more honest
 * than a guess from a cache.
 */
export function skipCoolingDown(order: string[]): string[] {
  const ready = order.filter((id) => cooldownRemaining(id) === 0);
  return ready.length > 0 ? ready : order;
}

export function clearCooldowns(): void {
  cooling.clear();
}
