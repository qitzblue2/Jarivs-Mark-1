import type { MemoryEntry } from "./types";

/** Words too common to say anything about relevance. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "at", "for", "with", "about", "as", "by", "from",
  "i", "me", "my", "you", "your", "it", "its", "this", "that", "these", "those",
  "do", "does", "did", "have", "has", "had", "what", "when", "where", "who",
  "how", "why", "can", "could", "would", "should", "will", "we", "our",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

/**
 * Score a memory against a query: term overlap, with a mild recency nudge.
 *
 * Deliberately not embeddings. For a few hundred personal facts, keyword
 * overlap is accurate enough, costs nothing, needs no model call, and stays
 * debuggable — you can see exactly why something was recalled.
 */
export function score(entry: MemoryEntry, queryTerms: Set<string>, now = Date.now()): number {
  if (queryTerms.size === 0) return 0;

  const entryTerms = new Set([...tokenize(entry.text), ...entry.tags.map((t) => t.toLowerCase())]);
  let overlap = 0;
  for (const term of queryTerms) if (entryTerms.has(term)) overlap++;

  if (overlap === 0) return 0;

  // Jaccard-ish: reward matches without letting long entries dominate.
  const base = overlap / Math.sqrt(queryTerms.size * Math.max(1, entryTerms.size));

  // Recency: a fact from today counts slightly more than one from a month ago.
  const ageDays = (now - entry.updatedAt) / 86_400_000;
  const recency = 1 + 0.3 / (1 + ageDays / 14);

  return base * recency;
}

/** Best matches for a query, most relevant first. */
export function rank(entries: MemoryEntry[], query: string, limit = 8): MemoryEntry[] {
  const terms = new Set(tokenize(query));
  return entries
    .map((entry) => ({ entry, value: score(entry, terms) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((row) => row.entry);
}

/**
 * Entries to put in the system prompt.
 *
 * Anything tagged `always` is pinned regardless of the query — that's how a
 * fact like your name stays available when you haven't mentioned it. The rest
 * is filled by relevance, inside a token budget.
 */
export function forPrompt(
  entries: MemoryEntry[],
  query: string,
  maxTokens = 400,
): MemoryEntry[] {
  const pinned = entries.filter((e) => e.tags.some((t) => t.toLowerCase() === "always"));
  const pinnedIds = new Set(pinned.map((e) => e.id));
  const relevant = rank(entries.filter((e) => !pinnedIds.has(e.id)), query);

  const chosen: MemoryEntry[] = [];
  let used = 0;

  for (const entry of [...pinned, ...relevant]) {
    const cost = Math.ceil(entry.text.length / 4) + 4;
    if (used + cost > maxTokens) continue;
    used += cost;
    chosen.push(entry);
  }

  return chosen;
}
