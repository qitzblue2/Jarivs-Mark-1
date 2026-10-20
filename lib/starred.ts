import type { Chat } from "@/lib/types";
import { splitReasoning } from "@/lib/reasoning";

/** One saved message, with enough context to find it again. */
export interface StarredItem {
  chatId: string;
  chatTitle: string;
  messageId: string;
  role: "user" | "assistant";
  /** The start of the message, for the list. */
  preview: string;
  createdAt: number;
  model?: string;
}

const PREVIEW = 280;

/** Every starred message across the given chats, newest first. */
export function listStarred(chats: Chat[], limit = 200): StarredItem[] {
  const items: StarredItem[] = [];
  for (const chat of chats) {
    for (const m of chat.messages) {
      if (!m.starred || (m.role !== "user" && m.role !== "assistant")) continue;
      // What was seen, not the hidden reasoning, as everywhere else.
      const text = m.role === "assistant" ? splitReasoning(m.content).answer || m.content : m.content;
      items.push({
        chatId: chat.id,
        chatTitle: chat.title,
        messageId: m.id,
        role: m.role,
        preview: text.replace(/\s+/g, " ").trim().slice(0, PREVIEW),
        createdAt: m.createdAt,
        ...(m.model ? { model: m.model } : {}),
      });
    }
  }
  return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
