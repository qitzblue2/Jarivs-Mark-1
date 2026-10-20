import { FsMemoryStore } from "./fs-store";
import type { MemoryStore } from "./types";

export type { MemoryEntry, MemoryStore } from "./types";
export { forPrompt, rank } from "./relevance";

let store: MemoryStore | null = null;

export function getMemory(): MemoryStore {
  if (!store) store = new FsMemoryStore();
  return store;
}
