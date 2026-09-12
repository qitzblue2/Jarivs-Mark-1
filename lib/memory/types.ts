/** One thing JARVIS remembers about you. */
export interface MemoryEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** Which conversation it was learned in, for provenance. */
  sourceChatId?: string;
}

/**
 * Same four-method shape as ChatStore (lib/storage/types.ts), for the same
 * reason: swapping the backing store later should be one new file.
 */
export interface MemoryStore {
  list(): Promise<MemoryEntry[]>;
  save(entry: MemoryEntry): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}
