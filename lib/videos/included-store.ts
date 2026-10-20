/**
 * Video models you have told JARVIS your subscription covers. NanoGPT's list
 * doesn't reliably say which video models a subscription includes, so the free
 * section is whatever the list marks free plus whatever you mark here. Kept in
 * this browser only, read defensively, and used only to sort the picker — it
 * changes nothing about what is sent or charged.
 */
export const INCLUDED_KEY = "jarvis.video-included.v1";

export function cleanIncluded(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9._\-:/]{1,80}$/.test(x) && !x.includes("..")))].slice(0, 200);
}

export function loadIncluded(storage: Pick<Storage, "getItem"> | null): string[] {
  try {
    const text = storage?.getItem(INCLUDED_KEY);
    return cleanIncluded(text ? JSON.parse(text) : []);
  } catch {
    return [];
  }
}

export function saveIncluded(storage: Pick<Storage, "setItem"> | null, ids: string[]): void {
  try {
    storage?.setItem(INCLUDED_KEY, JSON.stringify(cleanIncluded(ids)));
  } catch {
    // Remembering is a convenience.
  }
}

export const toggleIncluded = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : cleanIncluded([...ids, id]));

/** The models with your own marks applied: marked ones count as free. */
export function withIncluded<T extends { id: string; free?: boolean }>(models: T[], ids: string[]): T[] {
  return models.map((m) => (ids.includes(m.id) && !m.free ? { ...m, free: true } : m));
}
