import { normalizeTag, normalizeTags } from "@/lib/chat-ops";
import { estimateReplyTokens } from "@/lib/format";

/**
 * The small decisions behind writing a message: how long it is, which key sends
 * it, which model "/model fast" means, what "/tag work -old" does to a chat's
 * tags, what taking a message back leaves, what a saved prompt's blanks are, and
 * which of your old messages match a search.
 *
 * Pure, because every one of them has an edge a person would otherwise find by
 * losing a draft.
 */

// --- the counter ---------------------------------------------------------------

export interface Counts {
  words: number;
  chars: number;
  tokens: number;
}

/** Null for an empty or all-space box: a counter reading zero is just noise. */
export function composerCounts(text: string): Counts | null {
  if (!text.trim()) return null;
  return { words: text.trim().split(/\s+/).length, chars: text.length, tokens: estimateReplyTokens(text) };
}

export function counterLabel(c: Counts): string {
  const n = (v: number) => v.toLocaleString("en-US");
  return `${n(c.words)} word${c.words === 1 ? "" : "s"} · ${n(c.chars)} character${c.chars === 1 ? "" : "s"} · ~${n(c.tokens)} tokens`;
}

// --- the send key -------------------------------------------------------------------

export type SendKey = "enter" | "mod-enter";

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Whether this keystroke sends. With "enter" (the default) a bare Enter sends
 * and Shift+Enter is a new line; Ctrl/Cmd+Enter sends too, since people reach for
 * it. With "mod-enter", Enter is a new line and only Ctrl/Cmd+Enter sends — for
 * anyone who writes paragraphs and has lost a half-written one to a stray Enter.
 */
export function shouldSend(e: KeyLike, sendKey: SendKey): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  return sendKey === "mod-enter" ? e.ctrlKey || e.metaKey : true;
}

// --- /model --------------------------------------------------------------------------------

interface ProviderLike {
  id: string;
  label: string;
  ready: boolean;
  models: string[];
}

export interface ModelChoice {
  provider: string;
  model: string;
  /** "model · Provider" */
  label: string;
}

/**
 * The model a typed name means, among those that can answer right now. Every
 * word typed must appear somewhere in the model's id, its provider's id or its
 * label, so "fast", "groq fast" and "mock-fast-8b" all find it. An exact id beats
 * a prefix, which beats a match in the middle; ties keep the order they are
 * listed in. `others` are the runners-up, for saying what else matched.
 */
export function findModel(query: string, providers: ProviderLike[]): { choice: ModelChoice; others: ModelChoice[] } | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const typed = words.join(" ");

  const scored: { choice: ModelChoice; score: number }[] = [];
  for (const p of providers) {
    if (!p.ready) continue;
    for (const model of p.models) {
      const hay = `${model} ${p.id} ${p.label}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      const id = model.toLowerCase();
      const score = id === typed ? 4 : id.startsWith(words[0]) ? 3 : id.includes(words[0]) ? 2 : 1;
      scored.push({ choice: { provider: p.id, model, label: `${model} · ${p.label}` }, score });
    }
  }
  if (scored.length === 0) return null;
  // Stable: Array.sort keeps listed order for equal scores.
  scored.sort((a, b) => b.score - a.score);
  return { choice: scored[0].choice, others: scored.slice(1, 4).map((s) => s.choice) };
}

// --- /tag ------------------------------------------------------------------------------------------

export interface TagResult {
  tags: string[];
  added: string[];
  removed: string[];
  /** Words that couldn't be tags. */
  invalid: string[];
}

/**
 * `/tag work urgent` adds; `/tag -old` removes; both can be mixed. Tags are
 * tidied the same way as everywhere else (lowercase, no #, no odd characters).
 */
export function applyTagCommand(existing: string[], args: string): TagResult {
  const kept = new Set(normalizeTags(existing));
  const added: string[] = [];
  const removed: string[] = [];
  const invalid: string[] = [];
  for (const word of args.split(/[\s,]+/).filter(Boolean)) {
    const removing = word.startsWith("-") && word.length > 1;
    const tag = normalizeTag(removing ? word.slice(1) : word);
    if (!tag) {
      invalid.push(word);
    } else if (removing) {
      if (kept.delete(tag)) removed.push(tag);
    } else if (!kept.has(tag)) {
      kept.add(tag);
      added.push(tag);
    }
  }
  return { tags: normalizeTags([...kept]), added, removed, invalid };
}

// --- /undo --------------------------------------------------------------------------------------------

export interface Undone {
  /** The conversation without that exchange. */
  messages: { id: string; role: string; content: string; attachments?: unknown[] }[];
  /** What you had written, to put back in the box. */
  text: string;
  hadAttachments: boolean;
  /** How many messages went: yours and every reply after it. */
  removed: number;
}

/** Take back your last message and everything that followed it. Null if you have sent nothing. */
export function undoLastExchange<T extends { id: string; role: string; content: string; attachments?: unknown[] }>(messages: T[]): (Omit<Undone, "messages"> & { messages: T[] }) | null {
  let at = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      at = i;
      break;
    }
  }
  if (at === -1) return null;
  return {
    messages: messages.slice(0, at),
    text: messages[at].content,
    hadAttachments: Boolean(messages[at].attachments?.length),
    removed: messages.length - at,
  };
}

// --- blanks in saved prompts ---------------------------------------------------------------------------------

const VARIABLE = /\{\{\s*([A-Za-z][\w -]{0,30}?)\s*\}\}/g;
const pad = (n: number) => String(n).padStart(2, "0");
/** Filled in by JARVIS, never asked for. */
const BUILT_IN = (name: string, now: Date): string | null => {
  switch (name.toLowerCase()) {
    case "date":
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    case "time":
      return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    default:
      return null;
  }
};

/** The blanks a person has to fill, in the order they first appear, once each. `{{date}}` and `{{time}}` fill themselves. */
export function promptVariables(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(VARIABLE)) {
    const name = m[1].trim();
    if (BUILT_IN(name, new Date(0)) === null && !seen.some((s) => s.toLowerCase() === name.toLowerCase())) seen.push(name);
  }
  return seen;
}

/** The text with each blank replaced — by what was typed, else the built-in, else left as written so nothing vanishes silently. */
export function fillVariables(text: string, values: Record<string, string>, now = new Date()): string {
  const byLower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return text.replace(VARIABLE, (whole, raw: string) => {
    const name = raw.trim();
    const typed = byLower.get(name.toLowerCase());
    if (typed !== undefined && typed !== "") return typed;
    return BUILT_IN(name, now) ?? whole;
  });
}

// --- searching what you have sent ---------------------------------------------------------------------------------

export interface HistoryHit {
  text: string;
  /** The first line, shortened. */
  preview: string;
}

const PREVIEW = 100;

/** Your earlier messages containing the words typed, newest first, each once. Nothing typed lists the latest. */
export function searchHistory(entries: string[], query: string, limit = 8): HistoryHit[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const hits: HistoryHit[] = [];
  for (let i = entries.length - 1; i >= 0 && hits.length < limit; i--) {
    const text = entries[i];
    if (!text.trim() || seen.has(text)) continue;
    if (q && !text.toLowerCase().includes(q)) continue;
    seen.add(text);
    const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? text.trim();
    hits.push({ text, preview: line.length > PREVIEW ? `${line.slice(0, PREVIEW - 1)}…` : line });
  }
  return hits;
}

// --- reply style ------------------------------------------------------------------------------------------------------

export interface TemperaturePreset {
  id: "precise" | "balanced" | "creative";
  label: string;
  value: number;
  hint: string;
}

export const TEMPERATURE_PRESETS: TemperaturePreset[] = [
  { id: "precise", label: "Precise", value: 0.2, hint: "Steady, repeatable answers — for code, facts and maths" },
  { id: "balanced", label: "Balanced", value: 0.7, hint: "The default" },
  { id: "creative", label: "Creative", value: 1.1, hint: "More varied and surprising — for ideas and writing" },
];

/** The preset a temperature is, if it is one of them to within a hair; null for a value set by hand in Settings. */
export function presetOf(temperature: number): TemperaturePreset | null {
  return TEMPERATURE_PRESETS.find((p) => Math.abs(p.value - temperature) < 0.03) ?? null;
}

/** The next in the cycle precise → balanced → creative → precise; from a custom value, balanced. */
export function nextPreset(temperature: number): TemperaturePreset {
  const at = TEMPERATURE_PRESETS.findIndex((p) => p === presetOf(temperature));
  return at === -1 ? TEMPERATURE_PRESETS[1] : TEMPERATURE_PRESETS[(at + 1) % TEMPERATURE_PRESETS.length];
}

// --- reply length -------------------------------------------------------------------------------------------

export const REPLY_LENGTHS = ["brief", "normal", "detailed"] as const;
export type ReplyLength = (typeof REPLY_LENGTHS)[number];

export const LENGTH_LABEL: Record<ReplyLength, string> = { brief: "Brief", normal: "Normal", detailed: "Detailed" };
export const LENGTH_HINT_TEXT: Record<ReplyLength, string> = {
  brief: "Short answers: a few sentences",
  normal: "The usual length",
  detailed: "Thorough answers, with reasoning and examples",
};

export const isReplyLength = (value: unknown): value is ReplyLength => typeof value === "string" && (REPLY_LENGTHS as readonly string[]).includes(value);

export function nextLength(length: ReplyLength): ReplyLength {
  return REPLY_LENGTHS[(REPLY_LENGTHS.indexOf(length) + 1) % REPLY_LENGTHS.length];
}

/**
 * The one sentence added to the instructions for a turn. The server holds the
 * words: the page sends only a name, so it can't put its own text into the system
 * prompt this way. "Normal" adds nothing — the instructions you have are the
 * normal length.
 */
export function lengthHint(length: ReplyLength): string | null {
  if (length === "brief") return "Keep the reply short: answer in a few sentences and leave out preamble, caveats and recaps unless they change the answer.";
  if (length === "detailed") return "Give a thorough reply: explain the reasoning, cover the edge cases and include a concrete example where it helps.";
  return null;
}
