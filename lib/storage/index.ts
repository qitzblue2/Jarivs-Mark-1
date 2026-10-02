import { FsStore } from "./fs-store";
import { MemoryStore } from "./memory-store";
import type { ChatStore } from "./types";

export type { ChatStore } from "./types";

/**
 * One store per process, held on globalThis rather than in a module variable.
 *
 * A module can be evaluated twice — Next's dev reloads, or tsx loading the
 * same file as both ESM and CommonJS — and each copy would otherwise get its
 * own store. For the filesystem driver that is merely wasteful; for the
 * memory driver it is two disjoint sets of chats.
 */
const shared = globalThis as { __jarvisChatStore?: ChatStore };

/**
 * Pick a driver once per process.
 *
 * Default is the filesystem. Serverless hosts (Vercel) have a read-only
 * filesystem, so we fall back to memory there instead of crashing on the
 * first write — set JARVIS_STORAGE explicitly to override either way.
 */
export function getStore(): ChatStore {
  if (shared.__jarvisChatStore) return shared.__jarvisChatStore;

  const configured = process.env.JARVIS_STORAGE;
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const driver = configured ?? (serverless ? "memory" : "fs");

  shared.__jarvisChatStore = driver === "memory" ? new MemoryStore() : new FsStore();
  return shared.__jarvisChatStore;
}

export function storageDriver(): string {
  const configured = process.env.JARVIS_STORAGE;
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  return configured ?? (serverless ? "memory" : "fs");
}
