/**
 * Slowing down password guessing.
 *
 * One shared password is the only thing between the internet and your files
 * once JARVIS is behind a tunnel, so a script trying thousands of passwords is
 * the realistic attack. After MAX_FAILURES wrong guesses inside WINDOW_MS a
 * client is refused for the rest of the window — even with the right password,
 * which is what makes the lockout worth anything.
 *
 * Two limits, because the client key comes from forwarding headers an attacker
 * can set: one per apparent client, and one across everybody that is several
 * times larger. Rotating the header gets past the first and runs into the
 * second. The cost is that a determined attacker can lock you out for a window;
 * that is a nuisance, where the alternative is a guessed password.
 *
 * Kept in memory on globalThis (see lib/tools/fs/approval.ts for why): a
 * restart clears it, which is acceptable for a window measured in minutes.
 */

export const WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES = 5;
export const MAX_GLOBAL_FAILURES = 30;

interface State {
  perClient: Map<string, number[]>;
  global: number[];
}

const shared = globalThis as { __jarvisLoginLimiter?: State };
function state(): State {
  shared.__jarvisLoginLimiter ??= { perClient: new Map(), global: [] };
  return shared.__jarvisLoginLimiter;
}

function recent(times: number[], now: number): number[] {
  return times.filter((t) => now - t < WINDOW_MS);
}

/** Milliseconds until `times` allows another try, or 0 if it does now. */
function waitFor(times: number[], limit: number, now: number): number {
  const live = recent(times, now);
  if (live.length < limit) return 0;
  // The failure that must age out for the count to drop below the limit.
  return live[live.length - limit] + WINDOW_MS - now;
}

/**
 * Who is asking, as far as headers can tell. Not authentication — just the
 * best available bucket. A tunnel puts every visitor behind one address, in
 * which case the forwarded-for header is all there is.
 */
export function clientKey(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
  const first = forwarded?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : "direct";
}

/** Zero if this client may try a password now, otherwise how long to wait. */
export function retryAfterMs(key: string, now = Date.now()): number {
  const s = state();
  return Math.max(
    waitFor(s.perClient.get(key) ?? [], MAX_FAILURES, now),
    waitFor(s.global, MAX_GLOBAL_FAILURES, now),
  );
}

export function recordFailure(key: string, now = Date.now()): void {
  const s = state();
  const mine = recent(s.perClient.get(key) ?? [], now);
  mine.push(now);
  s.perClient.set(key, mine);
  s.global = recent(s.global, now);
  s.global.push(now);

  // Keep the map from growing without bound under a header-rotating attacker.
  if (s.perClient.size > 5000) {
    for (const [k, times] of s.perClient) if (recent(times, now).length === 0) s.perClient.delete(k);
  }
}

/** A correct password clears that client's record, not the global one. */
export function recordSuccess(key: string): void {
  state().perClient.delete(key);
}

export function resetLimiter(): void {
  shared.__jarvisLoginLimiter = { perClient: new Map(), global: [] };
}
