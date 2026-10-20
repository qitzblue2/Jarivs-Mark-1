"use client";

import { setServerInbox } from "./store";
import type { InboxItem } from "@/lib/inbox";

/**
 * The browser's side of the server inbox: fetch it, mark it read, clear it. Each
 * call leaves the store holding what the server now has, so a badge and a panel
 * showing it can't disagree.
 */

export async function fetchInbox(): Promise<InboxItem[] | null> {
  try {
    const res = await fetch("/api/inbox", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: InboxItem[] };
    const items = Array.isArray(data.items) ? data.items : [];
    setServerInbox(items);
    return items;
  } catch {
    // Offline, or the server is restarting: the badge keeps what it had.
    return null;
  }
}

async function post(body: { action: "read" | "clear"; ids?: string[] }): Promise<void> {
  try {
    await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    /* the next fetch shows what is true */
  }
  await fetchInbox();
}

export const markServerRead = (ids?: string[]) => post({ action: "read", ids });
export const clearServer = (ids?: string[]) => post({ action: "clear", ids });
