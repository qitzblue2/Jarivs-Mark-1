import type { Chat } from "@/lib/types";

/** Names inside the Markdown archive: the date, then the title, never twice the same. */

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chat";

/**
 * `2026-10-03-planning-the-trip.md`, with `-2`, `-3` … when a day has two chats
 * of one name. `used` is the set of names already taken in this archive, and is
 * added to.
 */
export function markdownEntryName(chat: Pick<Chat, "title" | "createdAt">, used: Set<string>): string {
  const base = `chats/${new Date(chat.createdAt).toISOString().slice(0, 10)}-${slug(chat.title)}`;
  let name = `${base}.md`;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}.md`;
  used.add(name);
  return name;
}

export function markdownArchiveName(now = new Date()): string {
  return `jarvis-chats-${now.toISOString().slice(0, 10)}.zip`;
}
