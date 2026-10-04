/** One thing JARVIS remembers about you. */
export interface MemoryEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** Which conversation it was learned in, for provenance. */
  sourceChatId?: string;
  /**
   * After this moment it is no longer put in the prompt. Never deleted for it:
   * it stays in the list, flagged, until a person removes it or extends it.
   */
  expires?: number;
}

/**
 * Same four-method shape as ChatStore (lib/storage/types.ts), for the same
 * reason: swapping the backing store later should be one new file.
 */
export interface MemoryStore {
  list(): Promise<MemoryEntry[]>;
  save(entry: MemoryEntry): Promise<void>;
  /** Add several at once — one write, not one per entry. */
  addMany(entries: MemoryEntry[]): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}
