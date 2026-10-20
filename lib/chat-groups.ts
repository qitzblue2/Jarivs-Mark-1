import type { ChatMeta } from "@/lib/types";

/**
 * The sidebar's sections.
 *
 * Pinned chats lead whatever their age. The rest fall into calendar buckets
 * measured from local midnight — "Today" means since you woke up, not the last
 * 24 hours — which is how every mail and chat app draws the line, and what a
 * person means by it.
 */

export interface ChatGroup<T extends ChatMeta = ChatMeta> {
  label: string;
  chats: T[];
}


function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function groupByDate<T extends ChatMeta>(chats: T[], now = Date.now()): ChatGroup<T>[] {
  const today = startOfDay(now);
  // Computed by calendar, not by subtracting 24 hours, so a clock change
  // doesn't put a chat in the wrong bucket for an hour.
  const dayStart = (daysAgo: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.getTime();
  };
  const yesterday = dayStart(1);
  const week = dayStart(7);
  const month = dayStart(30);

  const buckets: ChatGroup<T>[] = [
    { label: "Pinned", chats: [] },
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "Previous 7 days", chats: [] },
    { label: "Previous 30 days", chats: [] },
    { label: "Older", chats: [] },
  ];

  for (const chat of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const at = chat.updatedAt;
    const bucket = chat.pinned
      ? 0
      : at >= today
        ? 1
        : at >= yesterday
          ? 2
          : at >= week
            ? 3
            : at >= month
              ? 4
              : 5;
    buckets[bucket].chats.push(chat);
  }
  return buckets.filter((b) => b.chats.length > 0);
}
