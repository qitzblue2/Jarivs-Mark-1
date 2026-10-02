import type { Chat, ChatMeta, TrashedChat } from "@/lib/types";

/**
 * Storage is an interface so the backing store can change without touching a
 * route. Mark 1 shipped a filesystem driver and an in-memory driver; a cloud
 * driver later just implements these four methods.
 */
export interface ChatStore {
  list(): Promise<ChatMeta[]>;
  get(id: string): Promise<Chat | null>;
  save(chat: Chat): Promise<void>;
  /** Gone for good. What the app does on "delete" is `trash`, below. */
  delete(id: string): Promise<void>;

  /**
   * Deleting a chat moves it aside rather than destroying it, because the
   * button is one click and a click is not always meant. It can be restored
   * until it ages out (TRASH_DAYS), after which `purgeExpired` removes it.
   */
  trash(id: string): Promise<boolean>;
  listTrash(): Promise<TrashedChat[]>;
  /** Back to the chat list. False if it isn't in the trash. */
  restore(id: string): Promise<boolean>;
  /** Destroy one trashed chat for good. */
  purge(id: string): Promise<boolean>;
  /** Destroy everything older than the retention; returns how many went. */
  purgeExpired(now?: number): Promise<number>;
}

export const TRASH_DAYS = 30;
export const TRASH_MS = TRASH_DAYS * 24 * 60 * 60 * 1000;
