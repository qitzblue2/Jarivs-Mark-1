import type { Accent } from "@/lib/prefs";

/**
 * The highlight colours on offer. Each gives the four names the stylesheet
 * uses: `arc` (text and outlines), `dim` (borders and tints), `solid` (a button
 * fill that white text sits on) and its hover. Light and dark need different
 * `arc` values — bright on dark surfaces, deep on light ones — so each has both.
 *
 * The CSS in globals.css repeats these values (a stylesheet can't import
 * them), and a unit test reads the stylesheet and checks each one is there, and
 * that every accent clears 4.5:1 on every surface it is drawn on.
 */

export interface AccentColors {
  dark: { arc: string; dim: string };
  light: { arc: string; dim: string };
  solid: string;
  solidHover: string;
}

export const ACCENT_COLORS: Record<Accent, AccentColors> = {
  sky: { dark: { arc: "#38bdf8", dim: "#0ea5e9" }, light: { arc: "#075985", dim: "#0369a1" }, solid: "#0369a1", solidHover: "#075985" },
  violet: { dark: { arc: "#a78bfa", dim: "#8b5cf6" }, light: { arc: "#5b21b6", dim: "#6d28d9" }, solid: "#6d28d9", solidHover: "#5b21b6" },
  emerald: { dark: { arc: "#34d399", dim: "#10b981" }, light: { arc: "#047857", dim: "#059669" }, solid: "#047857", solidHover: "#065f46" },
  rose: { dark: { arc: "#fb7185", dim: "#f43f5e" }, light: { arc: "#9f1239", dim: "#be123c" }, solid: "#be123c", solidHover: "#9f1239" },
  orange: { dark: { arc: "#fb923c", dim: "#f97316" }, light: { arc: "#9a3412", dim: "#c2410c" }, solid: "#c2410c", solidHover: "#9a3412" },
};

export const ACCENT_LABEL: Record<Accent, string> = { sky: "Sky", violet: "Violet", emerald: "Emerald", rose: "Rose", orange: "Orange" };

/** The surfaces text in the accent colour is drawn on, per theme. */
export const SURFACES = {
  dark: ["#0a0d13", "#0f131c", "#151b27"],
  light: ["#f6f8fb", "#ffffff", "#eaeff6"],
} as const;

/** The stylesheet rules for every accent but the default, which lives in the theme itself. */
export function accentCss(): string {
  return (Object.keys(ACCENT_COLORS) as Accent[])
    .filter((id) => id !== "sky")
    .map((id) => {
      const c = ACCENT_COLORS[id];
      return (
        `html[data-accent="${id}"]{--color-arc:${c.dark.arc};--color-arc-dim:${c.dark.dim};--color-arc-solid:${c.solid};--color-arc-solid-hover:${c.solidHover}}\n` +
        `html[data-theme="light"][data-accent="${id}"]{--color-arc:${c.light.arc};--color-arc-dim:${c.light.dim}}`
      );
    })
    .join("\n");
}
