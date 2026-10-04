import type { ChatMeta } from "@/lib/types";

/**
 * How the chat list is ordered. "Recent" is the default and groups by day (that
 * code is in chat-groups.ts); the others are flat lists, because a heading that
 * says "Yesterday" over chats sorted by title would be a lie.
 */

export const CHAT_SORTS = ["recent", "oldest", "title", "messages"] as const;
export type ChatSort = (typeof CHAT_SORTS)[number];

export const SORT_LABEL: Record<ChatSort, string> = {
  recent: "Most recent first",
  oldest: "Oldest first",
  title: "By title, A to Z",
  messages: "Longest first",
};

export const isChatSort = (value: unknown): value is ChatSort => typeof value === "string" && (CHAT_SORTS as readonly string[]).includes(value);

export function nextSort(sort: ChatSort): ChatSort {
  return CHAT_SORTS[(CHAT_SORTS.indexOf(sort) + 1) % CHAT_SORTS.length];
}

/** A flat ordering, pinned chats first in every mode. Ties fall back to the most recent. */
export function sortChatList<T extends Pick<ChatMeta, "title" | "createdAt" | "updatedAt" | "messageCount" | "pinned">>(chats: T[], sort: ChatSort): T[] {
  const by: Record<ChatSort, (a: T, b: T) => number> = {
    recent: (a, b) => b.updatedAt - a.updatedAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }),
    messages: (a, b) => b.messageCount - a.messageCount,
  };
  return [...chats].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || by[sort](a, b) || b.updatedAt - a.updatedAt);
}
