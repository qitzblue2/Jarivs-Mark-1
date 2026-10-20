import type { SendKey } from "@/lib/composing";
import { isChatSort, type ChatSort } from "@/lib/chat-list";

/**
 * Small preferences about how the app behaves and reads, kept in this browser
 * (like appearance — a phone and a desk monitor can want different things) and
 * applied the moment they change. Anything unknown, old or hand-edited is made
 * valid field by field, so a bad value can never stop the app from loading.
 */

export const FONTS = ["sans", "serif", "mono", "readable"] as const;
export type Font = (typeof FONTS)[number];
export const ACCENTS = ["sky", "violet", "emerald", "rose", "orange"] as const;
export type Accent = (typeof ACCENTS)[number];
export const WIDTHS = ["narrow", "normal", "wide"] as const;
export type Width = (typeof WIDTHS)[number];
/** Lines past which a code block folds, or 0 for never. */
export const COLLAPSE_CHOICES = [0, 20, 40] as const;
export type Collapse = (typeof COLLAPSE_CHOICES)[number];

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
  /** Message text blurred until you point at it — for working where others can see the screen. */
  privacyBlur: boolean;
  /** What messages and the message box are set in. */
  font: Font;
  /** The highlight colour. */
  accent: Accent;
  /** How wide the conversation column is. */
  width: Width;
  /** The buttons under messages always showing, not only on hover. */
  alwaysActions: boolean;
  /** Fold code blocks longer than this many lines (0: never). */
  collapseCode: Collapse;
}

export const DEFAULT_PREFS: Prefs = {
  sendKey: "enter",
  spellcheck: true,
  chatSort: "recent",
  compactList: false,
  reasoningOpen: false,
  hideMeta: false,
  newChatModel: null,
  privacyBlur: false,
  font: "sans",
  accent: "sky",
  width: "normal",
  alwaysActions: false,
  collapseCode: 0,
};

export const PREFS_KEY = "jarvis.prefs.v1";

function pick<T>(list: readonly T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback;
}

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
    privacyBlur: typeof r.privacyBlur === "boolean" ? r.privacyBlur : DEFAULT_PREFS.privacyBlur,
    font: pick(FONTS, r.font, DEFAULT_PREFS.font),
    accent: pick(ACCENTS, r.accent, DEFAULT_PREFS.accent),
    width: pick(WIDTHS, r.width, DEFAULT_PREFS.width),
    alwaysActions: typeof r.alwaysActions === "boolean" ? r.alwaysActions : DEFAULT_PREFS.alwaysActions,
    collapseCode: pick(COLLAPSE_CHOICES, r.collapseCode, DEFAULT_PREFS.collapseCode),
  };
}

/** What the page needs on <html> for the CSS to do the rest: fonts, accent, width, blur, button visibility. */
export interface RootLike {
  setAttribute(name: string, value: string): void;
}

export function applyPrefs(root: RootLike, prefs: Prefs): void {
  root.setAttribute("data-font", prefs.font);
  root.setAttribute("data-accent", prefs.accent);
  root.setAttribute("data-width", prefs.width);
  root.setAttribute("data-blur", String(prefs.privacyBlur));
  root.setAttribute("data-actions", prefs.alwaysActions ? "always" : "hover");
}

/**
 * The same as reading the stored preferences and applying them, as text for a
 * <script> in <head>, so a chosen font, accent or width is there from the first
 * paint rather than arriving a moment after. Duplicated on purpose — it has to
 * run before any module does — and the unit tests run it against the real
 * functions for every value, so the two can't drift apart.
 */
export const PREFS_INIT_SCRIPT = `(function(){try{
var d=document.documentElement,p={};
try{p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})||"null")||{}}catch(e){}
function pick(list,v,f){return list.indexOf(v)>=0?v:f}
d.setAttribute("data-font",pick(${JSON.stringify(FONTS)},p.font,"sans"));
d.setAttribute("data-accent",pick(${JSON.stringify(ACCENTS)},p.accent,"sky"));
d.setAttribute("data-width",pick(${JSON.stringify(WIDTHS)},p.width,"normal"));
d.setAttribute("data-blur",String(p.privacyBlur===true));
d.setAttribute("data-actions",p.alwaysActions===true?"always":"hover");
}catch(e){}})();`;
