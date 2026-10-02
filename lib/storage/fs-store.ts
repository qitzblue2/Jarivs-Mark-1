import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/data-dir";
import { chatMeta, type Chat, type ChatMeta, type TrashedChat } from "@/lib/types";
import { TRASH_MS, type ChatStore } from "./types";

const chatsDir = () => dataPath("chats");
/** Beside the chats rather than inside them, so the chat list never sees it. */
const trashDir = () => dataPath("trash");

/** Reject anything that isn't a plain id, so an id can't escape the data dir. */
function safeName(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error(`Invalid chat id: ${id}`);
  return `${id}.json`;
}

function filePath(id: string): string {
  return path.join(chatsDir(), safeName(id));
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(chatsDir(), { recursive: true });
}

/** JSON files under ./data/chats — readable, greppable, easy to back up. */
export class FsStore implements ChatStore {
  async list(): Promise<ChatMeta[]> {
    await ensureDir();
    const entries = await fs.readdir(chatsDir());
    const metas: ChatMeta[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(chatsDir(), entry), "utf8");
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

  /**
   * Move a chat into data/trash, stamped with when. Written before the
   * original is removed, so a crash in between leaves two copies rather than
   * none.
   */
  async trash(id: string): Promise<boolean> {
    const chat = await this.get(id);
    if (!chat) return false;
    await fs.mkdir(trashDir(), { recursive: true });
    const stamped: TrashedChat = { ...chat, deletedAt: Date.now() };
    await fs.writeFile(path.join(trashDir(), safeName(id)), JSON.stringify(stamped, null, 2), "utf8");
    await this.delete(id);
    return true;
  }

  async listTrash(): Promise<TrashedChat[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(trashDir());
    } catch {
      return [];
    }
    const items: TrashedChat[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        items.push(JSON.parse(await fs.readFile(path.join(trashDir(), entry), "utf8")) as TrashedChat);
      } catch {
        /* a half-written file */
      }
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async restore(id: string): Promise<boolean> {
    const file = path.join(trashDir(), safeName(id));
    let item: TrashedChat;
    try {
      item = JSON.parse(await fs.readFile(file, "utf8")) as TrashedChat;
    } catch {
      return false;
    }
    const { deletedAt, ...chat } = item;
    void deletedAt;
    await this.save(chat);
    await fs.unlink(file).catch(() => {});
    return true;
  }

  async purge(id: string): Promise<boolean> {
    try {
      await fs.unlink(path.join(trashDir(), safeName(id)));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  async purgeExpired(now = Date.now()): Promise<number> {
    let removed = 0;
    for (const item of await this.listTrash()) {
      if (now - item.deletedAt > TRASH_MS && (await this.purge(item.id))) removed++;
    }
    return removed;
  }
}
