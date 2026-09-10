import type { Chat, ChatMeta } from "@/lib/types";

/**
 * Storage is an interface so the backing store can change without touching a
 * route. Mark 1 ships a filesystem driver and an in-memory driver; a cloud
 * driver later just implements these four methods.
 */
export interface ChatStore {
  list(): Promise<ChatMeta[]>;
  get(id: string): Promise<Chat | null>;
  save(chat: Chat): Promise<void>;
  delete(id: string): Promise<void>;
}
