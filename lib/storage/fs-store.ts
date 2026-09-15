import { promises as fs } from "node:fs";
import path from "node:path";
import { chatMeta, type Chat, type ChatMeta } from "@/lib/types";
import type { ChatStore } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "chats");

/** Reject anything that isn't a plain id, so an id can't escape the data dir. */
function safeName(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error(`Invalid chat id: ${id}`);
  return `${id}.json`;
}

function filePath(id: string): string {
  return path.join(DATA_DIR, safeName(id));
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/** JSON files under ./data/chats — readable, greppable, easy to back up. */
export class FsStore implements ChatStore {
  async list(): Promise<ChatMeta[]> {
    await ensureDir();
    const entries = await fs.readdir(DATA_DIR);
    const metas: ChatMeta[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(DATA_DIR, entry), "utf8");
        metas.push(chatMeta(JSON.parse(raw) as Chat));
      } catch {
        // Skip a corrupt or half-written file rather than failing the sidebar.
      }
    }

    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Chat | null> {
    try {
      return JSON.parse(await fs.readFile(filePath(id), "utf8")) as Chat;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(chat: Chat): Promise<void> {
    await ensureDir();
    // Write to a temp file then rename, so a crash mid-write can't corrupt
    // an existing chat.
    const target = filePath(chat.id);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(chat, null, 2), "utf8");
    await fs.rename(tmp, target);
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(filePath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
