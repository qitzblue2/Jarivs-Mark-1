import path from "node:path";

/**
 * Where everything of yours lives: chats, trash, memory, pictures, the
 * schedule, the usage count and the audit log.
 *
 * Read each time rather than once at import, because a module that captured
 * the folder when it loaded can't be pointed anywhere else afterwards — which
 * is how a test of the chat store ends up writing into your real chats.
 * `JARVIS_DATA_DIR` moves all of it together (a second install, a tests
 * folder, an external drive); the sandbox clears it so its data stays its own.
 */
export function dataDir(): string {
  return process.env.JARVIS_DATA_DIR || path.join(process.cwd(), "data");
}

export function dataPath(...parts: string[]): string {
  return path.join(dataDir(), ...parts);
}
