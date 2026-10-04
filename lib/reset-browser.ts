/**
 * "Reset this browser": which stored values to clear.
 *
 * Everything JARVIS keeps in a browser starts with "jarvis." — look, layout and
 * behaviour choices, unsent drafts, the last model — and nothing else does, so
 * nothing belonging to other sites or other apps on the same address can be
 * touched. Settings (API keys, your instructions, saved prompts, favourites)
 * are kept unless you say to include them: losing a key to a tidy-up would be
 * a poor trade for a tidier look.
 */

export const SETTINGS_STORAGE_KEY = "jarvis.settings.v1";

export function keysToReset(allKeys: string[], { includeSettings }: { includeSettings: boolean }): string[] {
  return allKeys.filter((k) => k.startsWith("jarvis.") && (includeSettings || k !== SETTINGS_STORAGE_KEY));
}

/** The keys in a Storage-like object. Never throws: some browsers refuse to list. */
export function listKeys(store: { length: number; key(i: number): string | null }): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k !== null) keys.push(k);
    }
  } catch {
    /* nothing to list */
  }
  return keys;
}
