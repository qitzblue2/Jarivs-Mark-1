/**
 * Unsent text, kept per chat.
 *
 * Switch chats to look something up and the half-written message is still
 * there when you come back; reload the page and it survives that too. Stored
 * in the browser's localStorage — it's your keystrokes, and nothing needs it
 * on the server.
 *
 * Bounded twice, because localStorage is small and shared: a draft is cut at
 * MAX_CHARS, and only the MAX_DRAFTS most recently edited are kept — older
 * ones are dropped as new ones arrive, so deleted chats don't leave drafts
 * behind forever. Every storage call can throw (private windows, a full
 * quota), and none of it is worth breaking typing over, so failures are quiet.
 */
export const MAX_CHARS = 20_000;
export const MAX_DRAFTS = 50;
const PREFIX = "jarvis.draft.";
const INDEX = "jarvis.drafts.index";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function readIndex(store: Store): string[] {
  try {
    const parsed = JSON.parse(store.getItem(INDEX) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function loadDraft(store: Store, key: string): string {
  try {
    return store.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

export function clearDraft(store: Store, key: string): void {
  try {
    store.removeItem(PREFIX + key);
    store.setItem(INDEX, JSON.stringify(readIndex(store).filter((k) => k !== key)));
  } catch {
    /* nothing worth failing for */
  }
}

export function saveDraft(store: Store, key: string, text: string): void {
  if (!text.trim()) return clearDraft(store, key);
  try {
    store.setItem(PREFIX + key, text.slice(0, MAX_CHARS));
    const index = [key, ...readIndex(store).filter((k) => k !== key)];
    for (const old of index.slice(MAX_DRAFTS)) store.removeItem(PREFIX + old);
    store.setItem(INDEX, JSON.stringify(index.slice(0, MAX_DRAFTS)));
  } catch {
    /* a full quota shouldn't interrupt typing */
  }
}

/** The key for a chat's draft; the empty "new chat" screen has its own. */
export const draftKey = (chatId: string | null | undefined) => chatId ?? "new";
