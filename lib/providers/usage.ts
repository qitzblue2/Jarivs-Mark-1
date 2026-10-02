import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/data-dir";

/**
 * What JARVIS has spent, per provider per day.
 *
 * Free tiers are metered in requests and tokens, and the only way to know how
 * close you are is to count — providers report remaining quota in headers
 * some of the time, differently each, and not at all when you're refused. So
 * this counts what went out from this server: every upstream request, what it
 * cost in estimated tokens, and how it ended. It is JARVIS' own tally, not the
 * provider's, which is why the page says so.
 *
 * Days are UTC because that is when the free tiers reset.
 */

export interface DayUsage {
  requests: number;
  ok: number;
  rateLimited: number;
  failed: number;
  /** Estimated input tokens, the same ~4 chars/token measure the trimmer uses. */
  tokensSent: number;
  lastAt: number;
  lastError?: string;
  /**
   * How the most recent request ended. The page's "now" column reads this,
   * not lastError: an error at nine o'clock says nothing about a provider
   * that has answered fifty times since.
   */
  lastOk?: boolean;
}

export interface UsageFile {
  /** "YYYY-MM-DD" → provider id → counts. */
  days: Record<string, Record<string, DayUsage>>;
}

const KEEP_DAYS = 14;
const SAVE_DELAY_MS = 2_000;

type Shared = {
  __jarvisUsage?: { data: UsageFile; loaded: boolean; loading?: Promise<void>; timer: NodeJS.Timeout | null };
};
const shared = globalThis as Shared;

function usagePath(): string {
  return process.env.JARVIS_USAGE_FILE || dataPath("usage.json");
}

function state() {
  if (!shared.__jarvisUsage) shared.__jarvisUsage = { data: { days: {} }, loaded: false, timer: null };
  return shared.__jarvisUsage;
}

export function utcDay(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Read the file once. Every caller shares the one read, so a caller arriving
 * mid-read waits for it instead of seeing counts the file hasn't joined yet.
 */
function load(): Promise<void> {
  const s = state();
  if (s.loaded) return s.loading ?? Promise.resolve();
  s.loaded = true;
  s.loading = readFile();
  return s.loading;
}

async function readFile(): Promise<void> {
  const s = state();
  try {
    const parsed = JSON.parse(await fs.readFile(usagePath(), "utf8")) as UsageFile;
    if (parsed && typeof parsed.days === "object") {
      // Anything counted before the file finished loading is kept on top.
      for (const [day, providers] of Object.entries(parsed.days)) {
        s.data.days[day] ??= {};
        for (const [id, counts] of Object.entries(providers)) {
          const mine = s.data.days[day][id];
          s.data.days[day][id] = mine
            ? {
                requests: counts.requests + mine.requests,
                ok: counts.ok + mine.ok,
                rateLimited: counts.rateLimited + mine.rateLimited,
                failed: counts.failed + mine.failed,
                tokensSent: counts.tokensSent + mine.tokensSent,
                lastAt: Math.max(counts.lastAt, mine.lastAt),
                lastError: mine.lastError ?? counts.lastError,
                lastOk: mine.lastAt >= counts.lastAt ? mine.lastOk : counts.lastOk,
              }
            : counts;
        }
      }
    }
  } catch {
    // No file yet, or unreadable: start counting from here.
  }
}

function prune(data: UsageFile): void {
  const days = Object.keys(data.days).sort();
  for (const day of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete data.days[day];
}

/** Written a moment later, so a burst of tool rounds is one write, not five. */
function scheduleSave(): void {
  const s = state();
  if (s.timer) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    void flushUsage();
  }, SAVE_DELAY_MS);
  s.timer.unref?.();
}

export async function flushUsage(): Promise<void> {
  const s = state();
  await load();
  prune(s.data);
  try {
    await fs.mkdir(path.dirname(usagePath()), { recursive: true });
    await fs.writeFile(usagePath(), JSON.stringify(s.data, null, 2));
  } catch {
    // A read-only host (serverless) still gets a live count; it just doesn't survive a restart.
  }
}

/**
 * Count one upstream request.
 *
 * `outcome` is the HTTP status, or "network" when nothing answered at all.
 * Never throws and never waits: counting must not be able to fail a chat.
 */
export function recordRequest(
  providerId: string,
  tokens: number,
  outcome: number | "network",
  error?: string,
): void {
  const s = state();
  void load();
  const day = utcDay();
  const today = (s.data.days[day] ??= {});
  const counts = (today[providerId] ??= { requests: 0, ok: 0, rateLimited: 0, failed: 0, tokensSent: 0, lastAt: 0 });

  counts.requests++;
  counts.tokensSent += Math.max(0, Math.round(tokens));
  counts.lastAt = Date.now();
  const ok = typeof outcome === "number" && outcome < 400;
  if (outcome === 429) counts.rateLimited++;
  else if (ok) counts.ok++;
  else counts.failed++;
  counts.lastOk = ok;
  if (error && outcome !== 429 && !ok) counts.lastError = error.slice(0, 200);

  scheduleSave();
}

/** Every day on record, newest first. */
export async function usageHistory(): Promise<{ day: string; providers: Record<string, DayUsage> }[]> {
  await load();
  return Object.entries(state().data.days)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, providers]) => ({ day, providers }));
}

/** For tests. */
export function resetUsage(): void {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  shared.__jarvisUsage = { data: { days: {} }, loaded: true, timer: null };
}
