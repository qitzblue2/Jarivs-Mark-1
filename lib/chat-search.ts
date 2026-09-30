import { chatMeta, type Chat, type ChatMeta } from "@/lib/types";
import { splitReasoning } from "@/lib/reasoning";

/** One chat that matched, with the line that made it match. */
export interface ChatHit extends ChatMeta {
  /** A short excerpt around the first match; absent when only the title matched. */
  snippet?: string;
}

const SNIPPET_RADIUS = 60;

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

  const texts = chat.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => (m.role === "assistant" ? splitReasoning(m.content).answer || m.content : m.content));
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
