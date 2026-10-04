import type { ResponseStats } from "@/lib/types";

/**
 * How a time reads in a chat: just the clock for today, "Yesterday 09:41",
 * "Oct 1, 09:41" this year, and the year only when it isn't this one — the
 * minimum that is still unambiguous.
 */
export function formatTime(at: number, now = Date.now(), locale?: string): string {
  const date = new Date(at);
  const today = new Date(now);
  const clock = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return clock;

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday ${clock}`;

  const day = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day}, ${clock}`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then the date. For a list row, not a log. */
export function relativeTime(ts: number, now = Date.now()): string {
  const seconds = Math.floor((now - ts) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * "1.4s · first word 0.3s · ~42 tok/s".
 *
 * The speed is left out when there isn't enough generation to measure — a
 * three-word answer in 90ms would read as thousands of tokens a second, which
 * says nothing about the model — and is marked approximate when shown, because
 * the token count is an estimate.
 */
export function describeStats(stats: ResponseStats): string {
  const parts = [duration(stats.totalMs)];
  if (stats.firstTokenMs > 0) parts.push(`first word ${duration(stats.firstTokenMs)}`);
  const generating = stats.totalMs - stats.firstTokenMs;
  if (stats.tokens >= 20 && generating >= 300) {
    parts.push(`~${Math.round(stats.tokens / (generating / 1000))} tok/s`);
  }
  return parts.join(" · ");
}

/** The ~4-characters-a-token estimate used everywhere else in the app. */
export function estimateReplyTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A message worth folding away: pasted logs, a file, a wall of text. */
export const LONG_MESSAGE_CHARS = 1500;
export const LONG_MESSAGE_LINES = 20;

export function isLongMessage(text: string): boolean {
  if (text.length > LONG_MESSAGE_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10 && ++lines > LONG_MESSAGE_LINES) return true;
  return false;
}

/** "0 B", "850 B", "1.2 KB", "34 MB", "1.5 GB" — binary units, one decimal under ten. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
