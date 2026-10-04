import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChatStore } from "@/lib/storage/types";
import type { MemoryEntry, MemoryStore } from "@/lib/memory/types";
import type { Chat } from "@/lib/types";
import { isImageId, sniffMime } from "@/lib/images/store";
import { MAX_TOTAL_BYTES, readZipDirectory, readZipEntry, ZipError } from "./unzip";

/**
 * Putting a backup back.
 *
 * Additive and never destructive: a chat, memory or picture that already
 * exists is left exactly as it is, and only what is missing is added. So
 * restoring over a working install can't lose today's work, and restoring the
 * same file twice is a no-op.
 *
 * What may be restored is an allowlist of exact path shapes, checked by
 * pattern — never by joining the archive's names onto a directory. A zip is
 * free to contain "data/../../.env.local"; that name matches nothing here and
 * is counted as ignored. The schedule is deliberately not restored: tasks that
 * start firing the moment a file lands, on a machine that didn't ask for them,
 * are not something a restore should do by surprise.
 */

export interface RestoreTargets {
  chats: ChatStore;
  memory: MemoryStore;
  imagesDir: string;
}

export interface RestoreReport {
  chats: { added: number; skipped: number; invalid: number };
  memory: { added: number; skipped: number };
  images: { added: number; skipped: number; invalid: number };
  /** Files in the archive that restore doesn't handle (schedule, usage, logs…). */
  ignored: number;
}

const CHAT_PATH = /^data\/chats\/([A-Za-z0-9_-]{1,128})\.json$/;
const IMAGE_PATH = /^data\/images\/([0-9a-f-]{36})\.(png|jpg|webp|gif)$/;
const IMAGE_META_PATH = /^data\/images\/([0-9a-f-]{36})\.json$/;
const MEMORY_PATH = "data/memory.json";

const EXT_FOR_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

function validChat(value: unknown, id: string): value is Chat {
  const c = value as Chat;
  return (
    !!c &&
    typeof c === "object" &&
    c.id === id &&
    typeof c.title === "string" &&
    typeof c.createdAt === "number" &&
    typeof c.updatedAt === "number" &&
    Array.isArray(c.messages) &&
    c.messages.every((m) => m && typeof m.id === "string" && typeof m.content === "string" && typeof m.role === "string")
  );
}

function validMemory(value: unknown): value is MemoryEntry {
  const m = value as MemoryEntry;
  return (
    !!m &&
    typeof m === "object" &&
    typeof m.id === "string" &&
    m.id.length > 0 &&
    typeof m.text === "string" &&
    m.text.length <= 1000 &&
    Array.isArray(m.tags) &&
    m.tags.every((t) => typeof t === "string") &&
    typeof m.createdAt === "number" &&
    typeof m.updatedAt === "number"
  );
}

const exists = (file: string) => fs.access(file).then(() => true).catch(() => false);

export async function restoreBackup(bytes: Uint8Array, targets: RestoreTargets): Promise<RestoreReport> {
  const entries = readZipDirectory(bytes);
  const report: RestoreReport = {
    chats: { added: 0, skipped: 0, invalid: 0 },
    memory: { added: 0, skipped: 0 },
    images: { added: 0, skipped: 0, invalid: 0 },
    ignored: 0,
  };

  let total = 0;
  for (const e of entries) total += e.size;
  if (total > MAX_TOTAL_BYTES) throw new ZipError("That archive would expand to more than 500MB.");

  const isRecognised = (name: string) =>
    CHAT_PATH.test(name) || IMAGE_PATH.test(name) || IMAGE_META_PATH.test(name) || name === MEMORY_PATH;

  // Read and verify every file we will use before writing any of them, so a
  // corrupt entry anywhere fails the restore cleanly instead of leaving it
  // half done. (Memory is bounded: the total was capped just above.)
  const files = new Map<string, Uint8Array>();
  for (const e of entries) if (isRecognised(e.name)) files.set(e.name, readZipEntry(bytes, e));

  // Pictures come as a pair — the image and its JSON — and are restored
  // together or not at all, so index the metadata by id first.
  const imageMeta = new Map<string, Uint8Array>();
  for (const [name, data] of files) {
    const m = IMAGE_META_PATH.exec(name);
    if (m && isImageId(m[1])) imageMeta.set(m[1], data);
  }

  for (const e of entries) {
    if (!isRecognised(e.name)) {
      if (!e.name.endsWith("/")) report.ignored++;
      continue;
    }

    const chat = CHAT_PATH.exec(e.name);
    if (chat) {
      const id = chat[1];
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(files.get(e.name)));
      } catch {
        report.chats.invalid++;
        continue;
      }
      if (!validChat(parsed, id)) {
        report.chats.invalid++;
        continue;
      }
      if (await targets.chats.get(id)) {
        report.chats.skipped++;
        continue;
      }
      await targets.chats.save(parsed);
      report.chats.added++;
      continue;
    }

    if (e.name === MEMORY_PATH) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(files.get(e.name)));
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      const have = new Set((await targets.memory.list()).map((x) => x.id));
      for (const item of parsed) {
        if (!validMemory(item)) continue;
        if (have.has(item.id)) report.memory.skipped++;
        else {
          await targets.memory.save(item);
          have.add(item.id);
          report.memory.added++;
        }
      }
      continue;
    }

    const image = IMAGE_PATH.exec(e.name);
    if (image) {
      const [, id, ext] = image;
      const data = files.get(e.name)!;
      const meta = imageMeta.get(id);
      const mime = sniffMime(data);
      // The bytes must really be the picture the name says, and have their
      // metadata; a ".png" that is HTML is not restored.
      if (!meta || !isImageId(id) || !mime || EXT_FOR_MIME[mime] !== ext) {
        report.images.invalid++;
        continue;
      }
      try {
        const parsedMeta = JSON.parse(new TextDecoder().decode(meta)) as { id?: unknown; mime?: unknown };
        if (parsedMeta.id !== id || parsedMeta.mime !== mime) {
          report.images.invalid++;
          continue;
        }
      } catch {
        report.images.invalid++;
        continue;
      }
      const dest = path.join(targets.imagesDir, `${id}.${ext}`);
      if (await exists(dest)) {
        report.images.skipped++;
        continue;
      }
      await fs.mkdir(targets.imagesDir, { recursive: true });
      await fs.writeFile(dest, data);
      await fs.writeFile(path.join(targets.imagesDir, `${id}.json`), meta);
      report.images.added++;
    }
    // A picture's own .json is handled with its image, above.
  }

  return report;
}

/** One line for the user: what came back, and what was already here. */
export function describeRestore(r: RestoreReport): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n > 0 && parts.push(`${n} ${n === 1 ? one : many}`);
  add(r.chats.added, "chat", "chats");
  add(r.memory.added, "memory", "memories");
  add(r.images.added, "picture", "pictures");
  const here = r.chats.skipped + r.memory.skipped + r.images.skipped;
  const bad = r.chats.invalid + r.images.invalid;
  const tail = [
    here > 0 ? `${here} already here, left alone` : "",
    bad > 0 ? `${bad} damaged, skipped` : "",
  ].filter(Boolean);
  const head = parts.length ? `Restored ${parts.join(", ")}` : "Nothing to restore";
  return tail.length ? `${head} — ${tail.join("; ")}.` : `${head}.`;
}
