import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/data-dir";
import { backupDir } from "@/lib/backup";
import { getStore } from "@/lib/storage";

/**
 * Where the disk space goes: how much your chats, pictures, backups and the rest
 * take, and which chats are the biggest. Read from the data folder on request;
 * nothing is kept or cached.
 */

export type UsageId = "chats" | "trash" | "pictures" | "backups" | "memory" | "other";

export const USAGE_LABEL: Record<UsageId, string> = {
  chats: "Chats",
  trash: "Trash",
  pictures: "Pictures",
  backups: "Daily backups",
  memory: "Memory",
  other: "Schedule, usage and logs",
};

/** Which row a file under the data folder belongs to, by its path from that folder. */
export function categorize(relativePath: string): UsageId {
  const first = relativePath.split(/[\\/]/)[0];
  if (first === "chats") return "chats";
  if (first === "trash") return "trash";
  if (first === "images") return "pictures";
  if (first === "backups") return "backups";
  if (first === "memory.json") return "memory";
  return "other";
}

export interface UsageRow {
  id: UsageId;
  label: string;
  bytes: number;
  files: number;
}

async function* walk(dir: string): AsyncGenerator<{ file: string; bytes: number }> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // A symlink could point anywhere, including back up the tree.
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) {
      try {
        yield { file: full, bytes: (await fs.stat(full)).size };
      } catch {
        /* vanished while measuring */
      }
    }
  }
}

export async function measureData(): Promise<{ rows: UsageRow[]; totalBytes: number; dir: string; disk: { free: number; total: number } | null }> {
  const root = dataDir();
  const tally = new Map<UsageId, UsageRow>();
  const add = (id: UsageId, bytes: number) => {
    const row = tally.get(id) ?? { id, label: USAGE_LABEL[id], bytes: 0, files: 0 };
    row.bytes += bytes;
    row.files++;
    tally.set(id, row);
  };

  for await (const { file, bytes } of walk(root)) add(categorize(path.relative(root, file)), bytes);
  // Backups can live somewhere else (JARVIS_BACKUP_DIR); count them wherever they are, once.
  const backups = backupDir();
  if (path.relative(root, backups).startsWith("..")) for await (const { bytes } of walk(backups)) add("backups", bytes);

  const order: UsageId[] = ["chats", "pictures", "trash", "backups", "memory", "other"];
  const rows = order.map((id) => tally.get(id) ?? { id, label: USAGE_LABEL[id], bytes: 0, files: 0 });

  let disk: { free: number; total: number } | null = null;
  try {
    const s = await fs.statfs(root);
    disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    /* not every platform can say */
  }
  return { rows, totalBytes: rows.reduce((n, r) => n + r.bytes, 0), dir: root, disk };
}

export interface BigChat {
  id: string;
  title: string;
  bytes: number;
  messages: number;
  updatedAt: number;
}

/** The chats that take the most room, biggest first. Size is what each is stored as: its JSON. */
export async function largestChats(limit = 10): Promise<BigChat[]> {
  const store = getStore();
  const rows: BigChat[] = [];
  for (const meta of await store.list()) {
    const chat = await store.get(meta.id);
    if (!chat) continue;
    rows.push({ id: chat.id, title: chat.title, bytes: Buffer.byteLength(JSON.stringify(chat)), messages: chat.messages.length, updatedAt: chat.updatedAt });
  }
  return rows.sort((a, b) => b.bytes - a.bytes).slice(0, Math.max(1, Math.min(50, limit)));
}
