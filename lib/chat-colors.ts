import { CHAT_COLORS, type ChatColor } from "@/lib/types";

/** Chosen to be told apart from one another and from the theme, in light and dark. */
export const COLOR_HEX: Record<ChatColor, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#a855f7",
};

export const COLOR_NAME: Record<ChatColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

export { CHAT_COLORS };
export type { ChatColor };
