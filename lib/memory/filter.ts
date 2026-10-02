import type { MemoryEntry } from "./types";

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 40;

/** "#Work", " work " and "WORK" are the same tag. */
export function normalizeTag(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, MAX_TAG_LENGTH);
}

/** Whatever a client sent as tags, as a short clean list without repeats. */
export function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = normalizeTag(item);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/** Tags typed into a box — "work, health #always" — split on commas and spaces. */
export function parseTagInput(input: string): string[] {
  return cleanTags(input.split(/[,\s]+/));
}

/** Every tag in use and how many entries carry it, most used first. */
export function tagCounts(entries: MemoryEntry[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) for (const tag of new Set(entry.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Entries matching a search and/or a tag. Every word of the search has to turn
 * up somewhere in the entry's text or its tags, in any order — the same rule
 * the chat search uses, so the two behave alike.
 */
export function filterMemory(
  entries: MemoryEntry[],
  { query = "", tag = "" }: { query?: string; tag?: string },
): MemoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = normalizeTag(tag);
  return entries.filter((entry) => {
    if (wanted && !entry.tags.includes(wanted)) return false;
    if (words.length === 0) return true;
    const haystack = `${entry.text} ${entry.tags.join(" ")}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
