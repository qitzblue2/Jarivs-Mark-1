import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { audit } from "@/lib/audit";
import { postToInbox } from "@/lib/inbox";
import { backupDir, backupEntries } from "./index";
import { zipStream } from "./zip";

/**
 * A backup a day, without being asked, keeping the last seven.
 *
 * Data you can lose to one bad click (a deleted chat is in the trash for 30
 * days, but a cleared memory or a bad import is not) is worth a copy you didn't
 * have to remember to make. Each is the same zip the Back up button makes, so
 * restoring one is the Restore button.
 *
 * What it does not do: protect against losing the disk. By default the copies
 * sit in data/backups beside the data; `JARVIS_BACKUP_DIR` points them at
 * another drive. And it leaves out pictures unless `JARVIS_AUTO_BACKUP_IMAGES=1`
 * — seven copies of a gallery is a lot of disk, and chats and memory are the
 * irreplaceable part. `JARVIS_AUTO_BACKUP=0` turns it off.
 */

export const AUTO_NAME = /^jarvis-auto-\d{4}-\d{2}-\d{2}\.zip$/;

export function autoBackupEnabled(): boolean {
  return process.env.JARVIS_AUTO_BACKUP !== "0";
}

export function backupsKept(): number {
  const n = Number(process.env.JARVIS_BACKUP_KEEP);
  return Number.isFinite(n) && n >= 1 ? Math.min(60, Math.floor(n)) : 7;
}

export function includesImages(): boolean {
  return process.env.JARVIS_AUTO_BACKUP_IMAGES === "1";
}

/** The server's own calendar day: "backup per day" means the day it is where JARVIS runs. */
function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const autoName = (date: Date) => `jarvis-auto-${localDay(date)}.zip`;

export interface AutoBackup {
  name: string;
  size: number;
  /** When the file was written. */
  at: number;
}

/** What is on disk, newest first. Only files that are ours by name. */
export async function listAutoBackups(): Promise<AutoBackup[]> {
  let names: string[];
  try {
    names = await fs.readdir(backupDir());
  } catch {
    return [];
  }
  const found: AutoBackup[] = [];
  for (const name of names.filter((n) => AUTO_NAME.test(n))) {
    try {
      const stat = await fs.stat(path.join(backupDir(), name));
      if (stat.isFile()) found.push({ name, size: stat.size, at: stat.mtimeMs });
    } catch {
      /* removed while listing */
    }
  }
  // The name carries the date and sorts correctly; the mtime does not survive a copy.
  return found.sort((a, b) => (a.name < b.name ? 1 : -1));
}

export interface AutoResult {
  created: string | null;
  /** Why nothing was made: today's already exists, or it is switched off. */
  skipped?: "exists" | "disabled";
  pruned: string[];
  error?: string;
}

let running: Promise<AutoResult> | null = null;

/**
 * Make today's backup if there isn't one, then drop the oldest past the limit.
 * `force` makes one even if today has one (the Back up now button), replacing it.
 * Never throws: a full disk is reported, not a crash in a timer.
 */
export function runAutoBackup(now = new Date(), force = false): Promise<AutoResult> {
  // One at a time: the hourly check and a click on the button must not race over one file.
  running ??= doBackup(now, force).finally(() => {
    running = null;
  });
  return running;
}

async function doBackup(now: Date, force: boolean): Promise<AutoResult> {
  if (!autoBackupEnabled() && !force) return { created: null, skipped: "disabled", pruned: [] };

  const dir = backupDir();
  const name = autoName(now);
  const target = path.join(dir, name);
  try {
    await fs.mkdir(dir, { recursive: true });
    if (!force && (await fs.stat(target).then((s) => s.isFile(), () => false))) {
      return { created: null, skipped: "exists", pruned: await prune() };
    }

    // Written under another name and renamed, so a half-written file is never
    // mistaken for a backup — and a crash leaves no good one overwritten.
    const partial = `${target}.partial`;
    try {
      await pipeline(
        Readable.fromWeb(zipStream(backupEntries({ skip: includesImages() ? [] : ["images"] })) as never),
        createWriteStream(partial),
      );
      await fs.rename(partial, target);
    } catch (err) {
      await fs.rm(partial, { force: true });
      throw err;
    }
    audit("backup.auto", name);
    return { created: name, pruned: await prune() };
  } catch (err) {
    return { created: null, pruned: [], error: (err as Error).message };
  }
}

/** Past the limit, oldest first. Only ever deletes files named like ours, in the backups folder. */
async function prune(): Promise<string[]> {
  const all = await listAutoBackups();
  const doomed = all.slice(backupsKept());
  const gone: string[] = [];
  for (const backup of doomed) {
    try {
      await fs.rm(path.join(backupDir(), backup.name));
      gone.push(backup.name);
    } catch {
      /* already gone */
    }
  }
  return gone;
}

type Shared = { __jarvisAutoBackup?: NodeJS.Timeout };
const shared = globalThis as Shared;

/**
 * Start the daily check: a minute after boot (not while the server is starting),
 * then hourly, so a server that was off at the usual time still makes today's
 * the first hour it is up. Idempotent, and never keeps the process alive.
 */
export function startAutoBackup(): void {
  // The sandbox copy has data of its own, which is nobody's to back up.
  if (shared.__jarvisAutoBackup || !autoBackupEnabled() || process.env.JARVIS_IS_SANDBOX === "1") return;
  const check = () => {
    void runAutoBackup().then((r) => {
      if (r.error) {
        console.error("[backup] automatic backup failed:", r.error);
        // Hourly retries of the same failure are one line in the inbox, not many.
        void postToInbox({
          kind: "backup",
          title: "Daily backup failed",
          body: `${r.error} — your chats aren't being copied until this is fixed.`,
          collapseWithin: 12 * 60 * 60 * 1000,
        }).catch(() => {});
      }
    });
  };
  const first = setTimeout(() => {
    check();
    shared.__jarvisAutoBackup = setInterval(check, 60 * 60 * 1000);
    shared.__jarvisAutoBackup.unref?.();
  }, 60_000);
  first.unref?.();
  shared.__jarvisAutoBackup = first;
}
