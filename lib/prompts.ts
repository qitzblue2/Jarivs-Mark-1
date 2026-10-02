/**
 * Saved prompts: text you reuse, found by name from the composer ("/review").
 *
 * They live in Settings, so they move with a settings export and are kept in
 * this browser only. A name is one lowercase word (letters, digits, hyphens)
 * so it can be typed after a slash, and can never be the name of a built-in
 * command — saving a prompt called "new" would make it unreachable.
 */
import { COMMAND_NAMES } from "@/lib/slash";

export interface SavedPrompt {
  name: string;
  text: string;
}

export const MAX_PROMPTS = 50;
export const MAX_PROMPT_TEXT = 8000;
export const MAX_PROMPT_NAME = 24;

export function normalizePromptName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PROMPT_NAME);
  if (!name || COMMAND_NAMES.includes(name)) return null;
  return name;
}

/** Validate a list from anywhere — storage, an imported file. Bad entries are dropped, not fixed. */
export function cleanPrompts(raw: unknown): SavedPrompt[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedPrompt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = normalizePromptName((item as SavedPrompt).name);
    const text = typeof (item as SavedPrompt).text === "string" ? (item as SavedPrompt).text.slice(0, MAX_PROMPT_TEXT) : "";
    if (!name || !text.trim() || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, text });
    if (out.length >= MAX_PROMPTS) break;
  }
  return out;
}
