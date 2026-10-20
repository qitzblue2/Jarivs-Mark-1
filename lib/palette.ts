/**
 * The command palette: type a few letters, run a thing. Everything it can do is
 * something already reachable by a button or a key; this is the one place
 * that lists them all and finds the one you mean.
 *
 * Matching is forgiving — every word typed must turn up, as the start of a word
 * if possible, otherwise somewhere inside, otherwise as letters in order ("nwch"
 * finds "New chat") — and ranked so the closest wins.
 */

export type PaletteGroup = "Actions" | "Chats" | "Models";

export interface PaletteItem {
  id: string;
  label: string;
  group: PaletteGroup;
  /** Shown at the right: a shortcut, or what the item is. */
  hint?: string;
  /** Extra words that find it ("dark light colour" for the theme). */
  keywords?: string;
}

/** Higher is better; null means a word typed isn't in there at all. */
export function matchScore(query: string, label: string, keywords = ""): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const text = label.toLowerCase();
  const extra = keywords.toLowerCase();
  let total = 0;

  for (const w of words) {
    let best = -1;
    if (text === w) best = 100;
    else if (text.startsWith(w)) best = 80;
    else if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text)) best = 60;
    else if (text.includes(w)) best = 40;
    else if (extra.split(/\s+/).some((k) => k.startsWith(w))) best = 30;
    else if (extra.includes(w)) best = 20;
    else {
      // The letters, in order, anywhere: "nwch" in "new chat".
      let at = -1;
      let gaps = 0;
      let ok = true;
      for (const ch of w) {
        const next = text.indexOf(ch, at + 1);
        if (next === -1) {
          ok = false;
          break;
        }
        if (at !== -1) gaps += next - at - 1;
        at = next;
      }
      if (ok && w.length >= 2) best = Math.max(1, 15 - gaps);
    }
    if (best < 0) return null;
    total += best;
  }
  // A shorter label that matches is more likely what was meant than a long one that happens to.
  return total - Math.min(text.length, 60) / 100;
}

/** The items matching the query, best first. With nothing typed: the first `limit`, in the order given. */
export function rankPalette<T extends PaletteItem>(items: T[], query: string, limit = 12): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item, order) => ({ item, order, score: matchScore(query, item.label, item.keywords) }))
    .filter((r): r is { item: T; order: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((r) => r.item);
}
