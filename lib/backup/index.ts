import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir as sharedDataDir } from "@/lib/data-dir";
import type { ZipEntry } from "./zip";

/**
 * Everything of yours, for the backup zip.
 *
 * All of it lives under ./data — chats, memory, pictures, the schedule, the
 * usage count — so a backup is that folder, laid out exactly as it sits on
 * disk. Restoring is unzipping it next to package.json. No format of our own
 * to migrate, and nothing a backup contains that you could not already read.
 */

export function dataDir(): string {
  return sharedDataDir();
}

const RESTORE = `JARVIS backup
=============

This is the data/ folder of a JARVIS install: chats, memory, pictures,
scheduled tasks and usage counts, as plain JSON and image files.

To restore, stop JARVIS and unzip this next to package.json, so the
files land in data/. Existing files with the same name are replaced;
anything else already there is kept.

API keys are not in here. They live in .env.local, or in the browser's
Settings, and a backup is safer without them.
`;

/**
 * Where automatic backups are kept (lib/backup/auto.ts). Never walked into by a
 * backup: a backup that contained the last seven backups would grow by a factor
 * each time it ran.
 */
export function backupDir(): string {
  return path.resolve(process.env.JARVIS_BACKUP_DIR || path.join(dataDir(), "backups"));
}

/** Walk data/ depth-first. Symlinks are skipped, so a backup can't reach outside it. */
async function* walk(root: string, dir: string, skip: Set<string>, skipPath: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // The backups folder wherever it is, and any top-level folder asked to be left out.
      if (path.resolve(full) === skipPath || (dir === root && skip.has(entry.name))) continue;
      yield* walk(root, full, skip, skipPath);
    } else if (entry.isFile()) yield full;
  }
}

export interface BackupOptions {
  /** Top-level names under data/ to leave out — the automatic backup skips "images" unless asked. */
  skip?: string[];
}

export async function* backupEntries(options: BackupOptions = {}): AsyncGenerator<ZipEntry> {
  yield { name: "RESTORE.txt", data: new TextEncoder().encode(RESTORE) };

  const root = dataDir();
  for await (const file of walk(root, root, new Set(options.skip ?? []), backupDir())) {
    try {
      const [data, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
      const relative = path.relative(root, file).split(path.sep).join("/");
      yield { name: `data/${relative}`, data: new Uint8Array(data), mtime: stat.mtime };
    } catch {
      // Deleted between listing and reading — a chat removed mid-backup.
    }
  }
}

export function backupFilename(at = new Date()): string {
  return `jarvis-backup-${at.toISOString().slice(0, 10)}.zip`;
}
