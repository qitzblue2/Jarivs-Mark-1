import { FsStore } from "./fs-store";
import { MemoryStore } from "./memory-store";
import type { ChatStore } from "./types";

export type { ChatStore } from "./types";

let store: ChatStore | null = null;

/**
 * Pick a driver once per process.
 *
 * Default is the filesystem. Serverless hosts (Vercel) have a read-only
 * filesystem, so we fall back to memory there instead of crashing on the
 * first write — set JARVIS_STORAGE explicitly to override either way.
 */
export function getStore(): ChatStore {
  if (store) return store;

  const configured = process.env.JARVIS_STORAGE;
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const driver = configured ?? (serverless ? "memory" : "fs");

  store = driver === "memory" ? new MemoryStore() : new FsStore();
  return store;
}

export function storageDriver(): string {
  const configured = process.env.JARVIS_STORAGE;
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  return configured ?? (serverless ? "memory" : "fs");
}
