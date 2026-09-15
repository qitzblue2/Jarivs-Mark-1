import { chatMeta, type Chat, type ChatMeta } from "@/lib/types";
import type { ChatStore } from "./types";

/**
 * Fallback for read-only filesystems (Vercel and friends). Chats live only as
 * long as the process does — enough to demo a deploy, not to rely on.
 */
export class MemoryStore implements ChatStore {
  private chats = new Map<string, Chat>();

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
}
