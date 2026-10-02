/**
 * Every keyboard shortcut, in one place: the dialog that lists them reads this,
 * and so do the tests — which press the keys listed here and check each one
 * does what it says, so the list can't promise something the app doesn't do.
 */

export interface Shortcut {
  /** "Mod" is Cmd on a Mac and Ctrl elsewhere. */
  keys: string[];
  action: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Chats",
    items: [
      { keys: ["Mod", "K"], action: "New chat" },
      { keys: ["Mod", "/"], action: "Search every chat" },
    ],
  },
  {
    title: "Message box",
    items: [
      { keys: ["Enter"], action: "Send" },
      { keys: ["Shift", "Enter"], action: "New line" },
      { keys: ["↑"], action: "Recall what you last sent (in an empty box)" },
      { keys: ["↓"], action: "Come back forward" },
      { keys: ["/"], action: "Commands and saved prompts" },
    ],
  },
  {
    title: "Voice and canvas",
    items: [
      { keys: ["Mod", "J"], action: "Voice mode" },
      { keys: ["Esc"], action: "Close the canvas or a dialog" },
    ],
  },
  {
    title: "Everywhere",
    items: [
      { keys: ["?"], action: "This list" },
      { keys: ["Tab"], action: "Move between controls; the first stop skips to the message box" },
    ],
  },
  {
    title: "Chat list edge",
    items: [
      { keys: ["←", "→"], action: "Resize the chat list (focus its edge first; Shift for bigger steps)" },
      { keys: ["Enter"], action: "Reset the chat list's width" },
    ],
  },
];

const MAC_LABELS: Record<string, string> = { Mod: "⌘", Shift: "⇧", Enter: "↵", Esc: "Esc" };
const OTHER_LABELS: Record<string, string> = { Mod: "Ctrl", Shift: "Shift", Enter: "Enter", Esc: "Esc" };

export function keyLabel(key: string, mac: boolean): string {
  return (mac ? MAC_LABELS : OTHER_LABELS)[key] ?? key;
}

export function isMac(platform: string | undefined): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "");
}

/** Whether keystrokes here are text being typed, where a bare "?" must stay a question mark. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** A bare "?" — Shift is how most keyboards make one, so it is allowed; Ctrl, Cmd and Alt are not. */
export function isHelpKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey;
}
