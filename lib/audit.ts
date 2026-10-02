import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/data-dir";

/**
 * A record of the things that matter after the fact.
 *
 * JARVIS can write files, run commands and change its own code, each behind an
 * approval. The approval is the control; this is the receipt — what was
 * allowed, when, so "what happened to my files last night" has an answer.
 *
 * One JSON object per line in data/audit.jsonl, newest last, rotated at 2MB so
 * it can't grow forever. It records what was asked and decided, never file
 * contents, passwords or keys; details are cut short.
 */

export type AuditKind =
  | "login.ok"
  | "login.fail"
  | "login.locked"
  | "approval.approve"
  | "approval.deny"
  | "sandbox.apply"
  | "sandbox.undo"
  | "sandbox.reset"
  | "backup.download"
  | "backup.auto"
  | "backup.auto.download"
  | "backup.restore"
  | "chat.trash"
  | "chat.restore";

export interface AuditEntry {
  at: number;
  kind: AuditKind;
  /** One short line: what, not the content. */
  detail?: string;
  /** The apparent client, for logins. */
  client?: string;
}

const MAX_BYTES = 2_000_000;
const MAX_DETAIL = 200;

export function auditFile(): string {
  return process.env.JARVIS_AUDIT_FILE || dataPath("audit.jsonl");
}

// One write at a time, so concurrent entries can't interleave mid-line.
let queue: Promise<void> = Promise.resolve();

/**
 * Record an event. Never throws and never waits on the caller: a log that can
 * break the thing it describes would be worse than no log.
 */
export function audit(kind: AuditKind, detail?: string, client?: string): void {
  const entry: AuditEntry = {
    at: Date.now(),
    kind,
    ...(detail ? { detail: detail.replace(/\s+/g, " ").slice(0, MAX_DETAIL) } : {}),
    ...(client ? { client: client.slice(0, 64) } : {}),
  };
  queue = queue
    .then(async () => {
      const file = auditFile();
      await fs.mkdir(path.dirname(file), { recursive: true });
      try {
        if ((await fs.stat(file)).size > MAX_BYTES) await fs.rename(file, `${file}.1`);
      } catch {
        /* no file yet */
      }
      await fs.appendFile(file, JSON.stringify(entry) + "\n");
    })
    .catch(() => {});
}

/** Wait for queued writes — for tests, and for a clean shutdown. */
export function flushAudit(): Promise<void> {
  return queue;
}

/** The most recent entries, newest first. Skips lines that don't parse. */
export async function recentAudit(limit = 100): Promise<AuditEntry[]> {
  await flushAudit();
  const read = (file: string) => fs.readFile(file, "utf8").catch(() => "");
  const text = (await read(`${auditFile()}.1`)) + (await read(auditFile()));
  const out: AuditEntry[] = [];
  for (const line of text.split("\n").reverse()) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as AuditEntry;
      if (typeof entry.at === "number" && typeof entry.kind === "string") out.push(entry);
    } catch {
      /* a half-written line */
    }
    if (out.length >= limit) break;
  }
  return out;
}
