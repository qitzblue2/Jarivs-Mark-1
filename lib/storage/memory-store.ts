import { chatMeta, type Chat, type ChatMeta, type TrashedChat } from "@/lib/types";
import { TRASH_MS, type ChatStore } from "./types";

/**
 * Fallback for read-only filesystems (Vercel and friends). Chats live only as
 * long as the process does — enough to demo a deploy, not to rely on.
 */
export class MemoryStore implements ChatStore {
  private chats = new Map<string, Chat>();
  private trashed = new Map<string, TrashedChat>();

  async list(): Promise<ChatMeta[]> {
    return [...this.chats.values()].map(chatMeta).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Chat | null> {
    return this.chats.get(id) ?? null;
  }

  async save(chat: Chat): Promise<void> {
    this.chats.set(chat.id, chat);
  }

  async delete(id: string): Promise<void> {
    this.chats.delete(id);
  }

  async trash(id: string): Promise<boolean> {
    const chat = this.chats.get(id);
    if (!chat) return false;
    this.chats.delete(id);
    this.trashed.set(id, { ...chat, deletedAt: Date.now() });
    return true;
  }

  async listTrash(): Promise<TrashedChat[]> {
    return [...this.trashed.values()].sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async restore(id: string): Promise<boolean> {
    const item = this.trashed.get(id);
    if (!item) return false;
    this.trashed.delete(id);
    const { deletedAt, ...chat } = item;
    void deletedAt;
    this.chats.set(id, chat);
    return true;
  }

  async purge(id: string): Promise<boolean> {
    return this.trashed.delete(id);
  }

  async purgeExpired(now = Date.now()): Promise<number> {
    let removed = 0;
    for (const [id, item] of this.trashed) {
      if (now - item.deletedAt > TRASH_MS) {
        this.trashed.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
