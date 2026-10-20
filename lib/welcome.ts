import type { ChatMeta } from "@/lib/types";

/**
 * What the empty screen says: a greeting for the hour, and where you left off.
 */

/** "Good morning" and so on, from the clock the person is looking at. */
export function timeGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 22) return "Good evening";
  return "Working late?";
}

/**
 * The chats worth offering to pick back up: newest first, not archived, and not
 * empty (a "New chat" that never got a message is a leftover, not somewhere you
 * were).
 */
export function recentChats(chats: ChatMeta[], limit = 4): ChatMeta[] {
  return chats
    .filter((c) => !c.archived && c.messageCount > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
