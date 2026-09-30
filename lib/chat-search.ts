import { chatMeta, type Chat, type ChatMeta } from "@/lib/types";
import { splitReasoning } from "@/lib/reasoning";

/** One chat that matched, with the line that made it match. */
export interface ChatHit extends ChatMeta {
  /** A short excerpt around the first match; absent when only the title matched. */
  snippet?: string;
}

const SNIPPET_RADIUS = 60;

/** What the user saw in each turn: their words and the answers, never hidden reasoning. */
function shownTexts(chat: Chat): string[] {
  return chat.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => (m.role === "assistant" ? splitReasoning(m.content).answer || m.content : m.content));
}

function excerpt(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + length + SNIPPET_RADIUS);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * Find chats by what was said in them, not just their title.
 *
 * Every word must appear somewhere in the chat (title or messages), in any
 * order and any case — "kite storm" finds the chat where a kite came up in
 * one message and a storm in another. A model's hidden reasoning is left out:
 * you are searching for what you saw, not what it muttered.
 */
export function matchChat(chat: Chat, query: string): ChatHit | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const texts = shownTexts(chat);
  const haystack = `${chat.title}\n${texts.join("\n")}`.toLowerCase();
  if (!words.every((w) => haystack.includes(w))) return null;

  const meta = chatMeta(chat);
  // The title matching every word says enough on its own.
  if (words.every((w) => chat.title.toLowerCase().includes(w))) return meta;

  for (const text of texts) {
    const at = text.toLowerCase().indexOf(words[0]);
    if (at >= 0) return { ...meta, snippet: excerpt(text, at, words[0].length) };
  }
  return meta;
}

/** Words too common to say anything about which chat is meant. */
const STOPWORDS = new Set(
  "the and for that this with what was were did about have from you your our we they them then than when where which who how why are but not can could would should will just into onto over any all its it's".split(" "),
);

/**
 * Rank chats for the model, which asks in phrases rather than keywords.
 *
 * `searchChats` wants every word, which is right for a person typing into a
 * box and wrong for "what did we decide about the holiday" — no chat contains
 * "decide". Here a chat scores by how many of the meaningful words it holds,
 * must hold at least half of them, and ties go to the more recent.
 */
export function rankChats(chats: Chat[], query: string, limit = 5): ChatHit[] {
  const words = [...new Set(
    query.toLowerCase().split(/[^a-z0-9\u00c0-\uffff]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  )];
  if (words.length === 0) return [];
  const needed = Math.max(1, Math.ceil(words.length / 2));

  const scored: { hit: ChatHit; score: number }[] = [];
  for (const chat of chats) {
    const texts = shownTexts(chat);
    const haystack = `${chat.title}\n${texts.join("\n")}`.toLowerCase();
    const found = words.filter((w) => haystack.includes(w));
    if (found.length < needed) continue;

    // Show the message that holds the most of the words, not merely the first.
    let best = "";
    let bestCount = 0;
    for (const text of texts) {
      const lower = text.toLowerCase();
      const count = found.filter((w) => lower.includes(w)).length;
      if (count > bestCount) [best, bestCount] = [text, count];
    }
    const at = best ? Math.max(0, found.map((w) => best.toLowerCase().indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0]) : -1;
    const hit: ChatHit = { ...chatMeta(chat), ...(best ? { snippet: excerpt(best, at, 0) } : {}) };
    scored.push({ hit, score: found.length });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.hit.updatedAt - a.hit.updatedAt)
    .slice(0, limit)
    .map((s) => s.hit);
}

/** Newest first, same as the sidebar, pinned chats leading. */
export function searchChats(chats: Chat[], query: string, limit = 50): ChatHit[] {
  const hits: ChatHit[] = [];
  for (const chat of chats) {
    const hit = matchChat(chat, query);
    if (hit) hits.push(hit);
  }
  return sortChats(hits).slice(0, limit);
}

/** Pinned first, then most recently active. */
export function sortChats<T extends ChatMeta>(chats: T[]): T[] {
  return [...chats].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt,
  );
}

/**
 * A chat as a Markdown document you can keep, share or paste elsewhere.
 *
 * Tool traces are summarised in a line rather than dumped: the raw results
 * are for debugging, and a page of search JSON is not what anyone exporting a
 * conversation wants to read. Reasoning is dropped for the same reason
 * speech drops it.
 */
export function chatToMarkdown(chat: Chat, origin = ""): string {
  const lines = [`# ${chat.title}`, "", `_Exported from JARVIS · ${new Date(chat.createdAt).toISOString().slice(0, 10)}_`, ""];

  for (const message of chat.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;

    const who = message.role === "user" ? "You" : `JARVIS${message.model ? ` (${message.model})` : ""}`;
    lines.push(`## ${who}`, "");

    const tools = (message.toolRounds ?? []).flatMap((r) => r.calls.map((c) => c.name));
    if (tools.length > 0) lines.push(`> Used ${[...new Set(tools)].join(", ")}`, "");

    let body = message.role === "assistant" ? splitReasoning(message.content).answer || message.content : message.content;
    // Same-origin picture paths only resolve inside the app; make them whole
    // so the export still points somewhere when opened elsewhere.
    if (origin) body = body.replace(/\]\((\/api\/images\/[0-9a-f-]{36})\)/g, `](${origin}$1)`);
    lines.push(body.trim() || "_(no text)_", "");

    for (const a of message.attachments ?? []) lines.push(`- 📎 ${a.name}`);
    if (message.attachments?.length) lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

/** A filename that survives every OS. */
export function exportFilename(chat: Chat): string {
  const base = chat.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${base || "chat"}.md`;
}
