import { toCsv } from "./csv";
import type { DayUsage } from "./providers/usage";

/**
 * The usage tally as a spreadsheet: one row per provider per UTC day, oldest
 * first. Goes through the same cell neutralising as every other CSV here, so a
 * provider's error message that happens to start with "=" can't become a formula.
 */
export function usageToCsv(
  days: { day: string; providers: Record<string, DayUsage> }[],
  labels: Record<string, string> = {},
): string {
  const rows: string[][] = [
    ["date_utc", "provider", "provider_name", "requests", "ok", "rate_limited", "failed", "tokens_sent_estimated", "last_request_utc", "last_error"],
  ];
  for (const { day, providers } of [...days].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    for (const [id, u] of Object.entries(providers).sort(([a], [b]) => a.localeCompare(b))) {
      rows.push([
        day,
        id,
        labels[id] ?? id,
        String(u.requests),
        String(u.ok),
        String(u.rateLimited),
        String(u.failed),
        String(u.tokensSent),
        u.lastAt ? new Date(u.lastAt).toISOString() : "",
        u.lastError ?? "",
      ]);
    }
  }
  return toCsv(rows);
}

export const usageFilename = (now = new Date()) => `jarvis-usage-${now.toISOString().slice(0, 10)}.csv`;
