/**
 * Models you starred in the picker, stored in Settings as "provider:model".
 *
 * Provider ids never contain a colon, but model ids can ("qwen2.5:7b" on a local
 * server), so a key is split at its *first* colon.
 */
export const MAX_FAVORITES = 50;

export const favoriteKey = (provider: string, model: string) => `${provider}:${model}`;

export function parseFavorite(key: string): { provider: string; model: string } | null {
  const at = key.indexOf(":");
  if (at < 1 || at === key.length - 1) return null;
  return { provider: key.slice(0, at), model: key.slice(at + 1) };
}

/** Whatever was stored — or imported from a file — as a short list of valid keys. */
export function cleanFavorites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || item.length > 300 || !parseFavorite(item)) continue;
    seen.add(item);
    if (seen.size >= MAX_FAVORITES) break;
  }
  return [...seen];
}

/** Starred ↔ not. A newly starred model goes to the top; past the limit the oldest star drops off. */
export function toggleFavorite(list: string[], key: string): string[] {
  if (list.includes(key)) return list.filter((k) => k !== key);
  return [key, ...list].slice(0, MAX_FAVORITES);
}

export const isFavorite = (list: string[] | undefined, provider: string, model: string) =>
  Boolean(list?.includes(favoriteKey(provider, model)));
