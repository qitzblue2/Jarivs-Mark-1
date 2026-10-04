import type { SendKey } from "@/lib/composing";

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
}

export const DEFAULT_PREFS: Prefs = {
  sendKey: "enter",
  spellcheck: true,
};

export const PREFS_KEY = "jarvis.prefs.v1";

export function cleanPrefs(raw: unknown): Prefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    sendKey: r.sendKey === "mod-enter" ? "mod-enter" : "enter",
    spellcheck: typeof r.spellcheck === "boolean" ? r.spellcheck : DEFAULT_PREFS.spellcheck,
  };
}
