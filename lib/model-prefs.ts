import { parseFavorite } from "@/lib/favorites";

/**
 * Settings about models and tools that are more than a switch: a note on a
 * model, tools turned off, how fussy to be about falling back. Each is checked
 * on its way in — from storage, from an imported file, from a request — so a
 * wrong-shaped value is dropped rather than trusted.
 */

// --- notes on models -----------------------------------------------------------

export const MAX_MODEL_NOTES = 50;
export const MAX_NOTE_LENGTH = 80;

/** A short reminder per model, keyed like favourites ("provider:model"), shown in the picker. */
export function cleanModelNotes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_MODEL_NOTES) break;
    if (key.length > 300 || !parseFavorite(key) || typeof value !== "string") continue;
    const note = value.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_LENGTH);
    if (note) out[key] = note;
  }
  return out;
}

/** Set, change or (with an empty note) remove one. Returns a new object. */
export function withModelNote(notes: Record<string, string>, key: string, note: string): Record<string, string> {
  const next = { ...notes };
  const clean = note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_LENGTH);
  if (clean) next[key] = clean;
  else delete next[key];
  return cleanModelNotes(next);
}

// --- tools turned off -------------------------------------------------------------

export const MAX_DISABLED_TOOLS = 40;

/** Tool names, as the registry spells them: lowercase letters, digits and underscores. */
export function cleanDisabledTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (/^[a-z][a-z0-9_]{0,39}$/.test(name)) seen.add(name);
    if (seen.size >= MAX_DISABLED_TOOLS) break;
  }
  return [...seen];
}

export function toggleTool(disabled: string[], name: string): string[] {
  return disabled.includes(name) ? disabled.filter((n) => n !== name) : cleanDisabledTools([...disabled, name]);
}
