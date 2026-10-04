import { cleanTags } from "./filter";
import type { MemoryEntry } from "./types";

/**
 * Moving memory between installs: a plain JSON file out, and a careful merge in.
 *
 * Import never edits or removes what is already remembered — it only adds. It
 * trusts nothing in the file: ids are regenerated (so a file can't overwrite an
 * existing entry by guessing its id), text and tags are cleaned and bounded, and
 * an entry that says the same thing as one you already have is skipped.
 *
 * Tags travel too, including `always`, which pins an entry into every chat's
 * system prompt. That is why the result reports how many pinned entries came in,
 * and why the prompt builder caps what pinned entries may cost (see forPrompt).
 */
export const MEMORY_FORMAT = "jarvis-memory";
export const MAX_IMPORT_ENTRIES = 2000;
export const MAX_ENTRY_CHARS = 2000;
/** The most entries memory will hold; an import stops adding at this. */
export const MAX_MEMORY_ENTRIES = 5000;

export interface MemoryFile {
  format: typeof MEMORY_FORMAT;
  version: 1;
  exportedAt: string;
  entries: Pick<MemoryEntry, "text" | "tags" | "createdAt" | "updatedAt" | "expires">[];
}

/** What gets written. `id` and `sourceChatId` are about this install, so they stay behind. */
export function exportMemory(entries: MemoryEntry[], now = new Date()): MemoryFile {
  return {
    format: MEMORY_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    entries: [...entries]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ text, tags, createdAt, updatedAt, expires }) => ({ text, tags, createdAt, updatedAt, ...(typeof expires === "number" ? { expires } : {}) })),
  };
}

export const exportFilename = (now = new Date()) => `jarvis-memory-${now.toISOString().slice(0, 10)}.json`;

/** Same fact, however it was capitalised or spaced. */
export const sameness = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

export interface ImportPlan {
  ok: true;
  add: MemoryEntry[];
  skipped: { duplicate: number; invalid: number; full: number };
  /** How many of the new entries are pinned into every chat. */
  pinned: number;
}

export type ImportOutcome = ImportPlan | { ok: false; error: string };

function timeOr(value: unknown, fallback: number, now: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= now + 86_400_000 ? value : fallback;
}

/**
 * Work out what an import would add, without adding it.
 *
 * Accepts the file `exportMemory` writes, or — for hand-written lists — a bare
 * array of entries or of plain strings.
 */
export function planImport(
  existing: MemoryEntry[],
  raw: unknown,
  newId: () => string,
  now = Date.now(),
): ImportOutcome {
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object") {
    const file = raw as Record<string, unknown>;
    if (file.format !== MEMORY_FORMAT) return { ok: false, error: "That doesn't look like a JARVIS memory file." };
    if (file.version !== 1) {
      return { ok: false, error: `This file is version ${String(file.version)}; this JARVIS reads version 1.` };
    }
    list = file.entries;
  } else {
    return { ok: false, error: "That doesn't look like a JARVIS memory file." };
  }
  if (!Array.isArray(list)) return { ok: false, error: "The file has no list of entries." };
  if (list.length > MAX_IMPORT_ENTRIES) {
    return { ok: false, error: `That file has ${list.length} entries; the limit for one import is ${MAX_IMPORT_ENTRIES}.` };
  }

  const known = new Set(existing.map((e) => sameness(e.text)));
  const add: MemoryEntry[] = [];
  const skipped = { duplicate: 0, invalid: 0, full: 0 };

  for (const item of list) {
    const record = typeof item === "string" ? { text: item } : item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const text = typeof record?.text === "string" ? record.text.trim() : "";
    if (!record || !text || text.length > MAX_ENTRY_CHARS) {
      skipped.invalid++;
      continue;
    }
    const key = sameness(text);
    if (known.has(key)) {
      skipped.duplicate++;
      continue;
    }
    if (existing.length + add.length >= MAX_MEMORY_ENTRIES) {
      skipped.full++;
      continue;
    }
    known.add(key);
    const createdAt = timeOr(record.createdAt, now, now);
    add.push({
      id: newId(),
      text,
      tags: cleanTags(record.tags),
      createdAt,
      updatedAt: timeOr(record.updatedAt, createdAt, now),
      ...(typeof record.expires === "number" && Number.isFinite(record.expires) && record.expires > 0 ? { expires: Math.floor(record.expires) } : {}),
    });
  }

  return { ok: true, add, skipped, pinned: add.filter((e) => e.tags.includes("always")).length };
}
