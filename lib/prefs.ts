import type { SendKey } from "@/lib/composing";
import { isChatSort, type ChatSort } from "@/lib/chat-list";

/**
 * Small preferences about how the app behaves and reads, kept in this browser
 * (like appearance — a phone and a desk monitor can want different things) and
 * applied the moment they change. Anything unknown, old or hand-edited is made
 * valid field by field, so a bad value can never stop the app from loading.
 */

export interface Prefs {
  /** What sends a message. */
  sendKey: SendKey;
  /** Red underlines in the message box. */
  spellcheck: boolean;
  /** How the chat list is ordered. */
  chatSort: ChatSort;
  /** The chat list without its second line (time, message count, tags). */
  compactList: boolean;
  /** A thinking model's reasoning shown open rather than folded away. */
  reasoningOpen: boolean;
  /** No model name, speed or reading time under replies. */
  hideMeta: boolean;
  /** A model every new chat starts with, or null for "whatever you used last". */
  newChatModel: { provider: string; model: string } | null;
}

export const DEFAULT_PREFS: Prefs = {
  sendKey: "enter",
  spellcheck: true,
  chatSort: "recent",
  compactList: false,
  reasoningOpen: false,
  hideMeta: false,
  newChatModel: null,
};

export const PREFS_KEY = "jarvis.prefs.v1";

function cleanNewChatModel(raw: unknown): Prefs["newChatModel"] {
  if (!raw || typeof raw !== "object") return null;
  const { provider, model } = raw as Record<string, unknown>;
  if (typeof provider !== "string" || typeof model !== "string") return null;
  if (!/^[\w-]{1,40}$/.test(provider) || model.length < 1 || model.length > 200) return null;
  return { provider, model };
}

export function cleanPrefs(raw: unknown): Prefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    sendKey: r.sendKey === "mod-enter" ? "mod-enter" : "enter",
    spellcheck: typeof r.spellcheck === "boolean" ? r.spellcheck : DEFAULT_PREFS.spellcheck,
    chatSort: isChatSort(r.chatSort) ? r.chatSort : DEFAULT_PREFS.chatSort,
    compactList: typeof r.compactList === "boolean" ? r.compactList : DEFAULT_PREFS.compactList,
    reasoningOpen: typeof r.reasoningOpen === "boolean" ? r.reasoningOpen : DEFAULT_PREFS.reasoningOpen,
    hideMeta: typeof r.hideMeta === "boolean" ? r.hideMeta : DEFAULT_PREFS.hideMeta,
    newChatModel: cleanNewChatModel(r.newChatModel),
  };
}
