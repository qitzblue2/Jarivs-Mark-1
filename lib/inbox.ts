import { promises as fs } from "node:fs";
import path from "node:path";
import { newId } from "@/lib/types";
import { dataPath } from "@/lib/data-dir";

/**
 * What JARVIS said when you weren't looking: the answer a scheduled task came
 * back with at eight this morning, a daily backup that failed overnight.
 *
 * Until now those went only where nobody might be — the room speaker, the
 * display — or nowhere at all. This keeps them where the app can show them the
 * next time it is open, and only the server writes to it: the page can read,
 * mark read and clear, but cannot make JARVIS "say" something.
 *
 * One small JSON file in data/, read afresh each time rather than cached, which
 * keeps it correct across restarts and means a person can open it.
 */

export type InboxKind = "scheduled" | "backup";

export interface InboxItem {
  id: string;
  at: number;
  kind: InboxKind;
  title: string;
  body: string;
  read: boolean;
}

export const MAX_ITEMS = 100;
export const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_TITLE = 120;
const MAX_BODY = 2000;

const file = () => dataPath("inbox.json");

function isItem(value: unknown): value is InboxItem {
  const v = value as Partial<InboxItem> | null;
  return (
    !!v &&
    typeof v.id === "string" &&
    typeof v.at === "number" &&
    (v.kind === "scheduled" || v.kind === "backup") &&
    typeof v.title === "string" &&
    typeof v.body === "string" &&
    typeof v.read === "boolean"
  );
}

async function readAll(): Promise<InboxItem[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8")) as { items?: unknown };
    return Array.isArray(parsed.items) ? parsed.items.filter(isItem) : [];
  } catch {
    // No file yet, or one that was hand-edited into something unreadable.
    return [];
  }
}

async function writeAll(items: InboxItem[]): Promise<void> {
  await fs.mkdir(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ items }, null, 2), "utf8");
  await fs.rename(tmp, file());
}

/** Newest first, the oldest and the surplus dropped. */
function trim(items: InboxItem[], now: number): InboxItem[] {
  return items
    .filter((i) => now - i.at < KEEP_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ITEMS);
}

// One change at a time, so two arriving together can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

export async function listInbox(now = Date.now()): Promise<InboxItem[]> {
  return trim(await readAll(), now);
}

export interface NewItem {
  kind: InboxKind;
  title: string;
  body: string;
  /**
   * If an unread item with the same kind and title arrived within this long,
   * replace it rather than add another — a backup that fails every hour should
   * be one line, not twenty-four.
   */
  collapseWithin?: number;
}

export function postToInbox(item: NewItem, now = Date.now()): Promise<InboxItem> {
  return exclusive(async () => {
    const title = item.title.trim().slice(0, MAX_TITLE) || "JARVIS";
    const body = item.body.trim().slice(0, MAX_BODY);
    const all = await readAll();

    if (item.collapseWithin) {
      const same = all.find((i) => !i.read && i.kind === item.kind && i.title === title && now - i.at < item.collapseWithin!);
      if (same) {
        const updated = { ...same, at: now, body };
        await writeAll(trim(all.map((i) => (i.id === same.id ? updated : i)), now));
        return updated;
      }
    }

    const added: InboxItem = { id: newId(), at: now, kind: item.kind, title, body, read: false };
    await writeAll(trim([added, ...all], now));
    return added;
  });
}

/** Mark some (or, with no ids, all) as read. Returns how many changed. */
export function markRead(ids?: string[], now = Date.now()): Promise<number> {
  return exclusive(async () => {
    const all = await readAll();
    let changed = 0;
    const next = all.map((i) => {
      if (i.read || (ids && !ids.includes(i.id))) return i;
      changed++;
      return { ...i, read: true };
    });
    if (changed) await writeAll(trim(next, now));
    return changed;
  });
}

/** Remove some (or, with no ids, all). Returns how many went. */
export function clearInbox(ids?: string[], now = Date.now()): Promise<number> {
  return exclusive(async () => {
    const all = await readAll();
    const keep = ids ? all.filter((i) => !ids.includes(i.id)) : [];
    if (keep.length !== all.length) await writeAll(trim(keep, now));
    return all.length - keep.length;
  });
}
