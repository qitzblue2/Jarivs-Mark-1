import { splitReasoning } from "@/lib/reasoning";
import { toPlainText } from "@/lib/reading";
import { cleanTags } from "./filter";
import { MAX_ENTRY_CHARS, sameness } from "./transfer";
import type { MemoryEntry } from "./types";

/**
 * Keeping what JARVIS remembers tidy: facts that run out, many added at once,
 * the same fact said twice, and a draft of what to save from a message.
 *
 * Nothing here deletes anything on its own. Expired facts are left out of the
 * prompt and flagged; duplicates are found and offered for merging; both wait
 * for a person to say yes.
 */

const DAY = 86_400_000;

// --- expiry ----------------------------------------------------------------------

export function isExpired(entry: Pick<MemoryEntry, "expires">, now = Date.now()): boolean {
  return typeof entry.expires === "number" && entry.expires <= now;
}

/** "expired", "expires today", "expires tomorrow", "expires in 12 days" — or null for a fact that stays. */
export function expiryLabel(entry: Pick<MemoryEntry, "expires">, now = Date.now()): string | null {
  if (typeof entry.expires !== "number") return null;
  if (entry.expires <= now) return "expired";
  const days = Math.ceil((entry.expires - now) / DAY);
  return days <= 1 ? "expires today" : days === 2 ? "expires tomorrow" : `expires in ${days - 1} days`;
}

/** The last moment of the day a date field names, in the browser's own time zone — "until the 12th" includes the 12th. */
export function expiryFromDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(y, mo - 1, d, 23, 59, 59, 999);
  // 2026-02-31 would quietly become March; refuse it instead.
  return at.getFullYear() === y && at.getMonth() === mo - 1 && at.getDate() === d ? at.getTime() : null;
}

export function dateInputOf(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** What a request may say about expiry: a time, or null to clear it; anything else is "not specified". */
export function cleanExpiry(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return undefined;
}

// --- adding many ------------------------------------------------------------------

export const MAX_BULK_LINES = 100;

export interface BulkPlan {
  add: { text: string; tags: string[] }[];
  skipped: { duplicate: number; tooLong: number; empty: number; overLimit: number };
}

/**
 * Lines of text as separate facts. A leading bullet or number is dropped, and
 * `#tags` at the end of a line become its tags: "Allergic to peanuts #health".
 * A line already remembered, or repeated in the same list, is skipped.
 */
export function parseBulk(raw: string, existing: string[] = []): BulkPlan {
  const known = new Set(existing.map(sameness));
  const plan: BulkPlan = { add: [], skipped: { duplicate: 0, tooLong: 0, empty: 0, overLimit: 0 } };
  let seen = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (++seen > MAX_BULK_LINES) {
      plan.skipped.overLimit++;
      continue;
    }
    const stripped = line.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, "").trim();
    // The run of #words at the very end are tags; a #word earlier in the line is just text.
    const parts = stripped.split(/\s+/);
    const found: string[] = [];
    while (parts.length > 0 && /^#[\w-]+$/.test(parts[parts.length - 1])) found.unshift(parts.pop()!);
    const tags = cleanTags(found);
    const text = parts.join(" ");
    if (!text) {
      plan.skipped.empty++;
      continue;
    }
    if (text.length > MAX_ENTRY_CHARS) {
      plan.skipped.tooLong++;
      continue;
    }
    const key = sameness(text);
    if (known.has(key)) {
      plan.skipped.duplicate++;
      continue;
    }
    known.add(key);
    plan.add.push({ text, tags });
  }
  return plan;
}

// --- the same fact twice --------------------------------------------------------------

export interface DuplicateGroup {
  /** The one to keep: the most recently touched, the longer on a tie. */
  keep: MemoryEntry;
  extras: MemoryEntry[];
}

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean));

/** How much of the smaller wording the two share — "I like tea" inside "I like tea a lot" is a full match. */
function overlap(a: Set<string>, b: Set<string>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared / small.size;
}

export const SIMILAR = 0.85;
/** Comparing every pair is quadratic; this is plenty for a personal memory and keeps it instant. */
export const MAX_COMPARED = 1500;

/**
 * Entries that say the same thing: identical once case and spacing are ignored,
 * or sharing nearly all their words (and at least three). Each group names the
 * entry worth keeping.
 */
export function findDuplicates(entries: MemoryEntry[]): DuplicateGroup[] {
  const list = [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_COMPARED);
  const sets = list.map((e) => words(e.text));
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const same = sameness(list[i].text) === sameness(list[j].text);
      const close = Math.min(sets[i].size, sets[j].size) >= 3 && overlap(sets[i], sets[j]) >= SIMILAR && Math.abs(sets[i].size - sets[j].size) <= Math.max(2, Math.min(sets[i].size, sets[j].size) * 0.5);
      if (same || close) parent[find(j)] = find(i);
    }
  }

  const groups = new Map<number, MemoryEntry[]>();
  list.forEach((e, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), e]));
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const ordered = [...g].sort((a, b) => b.updatedAt - a.updatedAt || b.text.length - a.text.length);
      return { keep: ordered[0], extras: ordered.slice(1) };
    })
    .sort((a, b) => b.extras.length - a.extras.length || a.keep.text.localeCompare(b.keep.text));
}

/** The one entry a group becomes: the kept wording, everyone's tags, the earliest start — and it only expires if all of them did. */
export function mergeGroup(group: DuplicateGroup): MemoryEntry {
  const all = [group.keep, ...group.extras];
  const expiries = all.map((e) => e.expires);
  const expires = expiries.every((x): x is number => typeof x === "number") ? Math.max(...expiries) : undefined;
  return {
    ...group.keep,
    tags: cleanTags(all.flatMap((e) => e.tags)),
    createdAt: Math.min(...all.map((e) => e.createdAt)),
    updatedAt: Math.max(...all.map((e) => e.updatedAt)),
    ...(expires !== undefined ? { expires } : { expires: undefined }),
  };
}

// --- remembering from a message ------------------------------------------------------------

export const MAX_DRAFT = 400;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const at = sentence > max * 0.6 ? sentence + 1 : Math.max(cut.lastIndexOf(" "), 0) || max;
  return `${cut.slice(0, at).trimEnd()}…`;
}

/**
 * What to offer to save from a message: the words you had selected, or else the
 * start of the message as plain text — one line, cut at a sentence if it can be.
 * Always short: a memory costs tokens in every chat it is relevant to.
 */
export function rememberDraft(content: string, selection = ""): string {
  const picked = selection.replace(/\s+/g, " ").trim();
  if (picked) return clip(picked, MAX_DRAFT);
  const plain = toPlainText(splitReasoning(content).answer || content).replace(/\s+/g, " ").trim();
  return clip(plain, MAX_DRAFT);
}
