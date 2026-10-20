/**
 * How JARVIS looks on this device: theme, text size, density, sidebar width.
 *
 * Kept in the browser's localStorage rather than in Settings, deliberately.
 * It is a property of the screen in front of you — a phone and a desk monitor
 * want different answers — so it is not sent to the server and does not travel
 * with Settings export/import.
 *
 * Applied as attributes on <html> (`data-theme`, `data-text`, `data-density`)
 * and one CSS variable (`--sidebar-w`); globals.css does the rest. A small
 * inline script (INIT_SCRIPT) does the same before the first paint, so a light
 * theme doesn't start with a dark flash while React loads.
 */

export const THEMES = ["system", "dark", "light"] as const;
export const TEXT_SIZES = ["small", "normal", "large", "xlarge"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;

export type Theme = (typeof THEMES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type Density = (typeof DENSITIES)[number];

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 260;

export interface Appearance {
  theme: Theme;
  textSize: TextSize;
  density: Density;
  sidebarWidth: number;
}

export const APPEARANCE_KEY = "jarvis.appearance";

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  textSize: "normal",
  density: "comfortable",
  sidebarWidth: SIDEBAR_DEFAULT,
};

/** The base colour of each theme, for the browser chrome (the installed app's title bar). */
export const THEME_COLOR = { dark: "#0a0d13", light: "#f6f8fb" } as const;

export function clampSidebar(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Whatever was stored — old, hand-edited, from a future version — becomes something valid. */
export function cleanAppearance(raw: unknown): Appearance {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    theme: pick(THEMES, r.theme, DEFAULT_APPEARANCE.theme),
    textSize: pick(TEXT_SIZES, r.textSize, DEFAULT_APPEARANCE.textSize),
    density: pick(DENSITIES, r.density, DEFAULT_APPEARANCE.density),
    sidebarWidth: clampSidebar(r.sidebarWidth),
  };
}

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;

export function loadAppearance(store: ReadStore): Appearance {
  try {
    return cleanAppearance(JSON.parse(store.getItem(APPEARANCE_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(store: WriteStore, appearance: Appearance): void {
  try {
    store.setItem(APPEARANCE_KEY, JSON.stringify(cleanAppearance(appearance)));
  } catch {
    /* private windows and full quotas: the choice just won't outlive the tab */
  }
}

export function resolveTheme(theme: Theme, prefersLight: boolean): "dark" | "light" {
  if (theme === "system") return prefersLight ? "light" : "dark";
  return theme;
}

export interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void };
}

export function applyAppearance(root: RootLike, appearance: Appearance, prefersLight: boolean): void {
  root.setAttribute("data-theme", resolveTheme(appearance.theme, prefersLight));
  root.setAttribute("data-text", appearance.textSize);
  root.setAttribute("data-density", appearance.density);
  root.style.setProperty("--sidebar-w", `${appearance.sidebarWidth}px`);
}

/**
 * The same thing as loadAppearance + applyAppearance, as text for a <script>
 * in <head>. Duplicated on purpose — it must run before any module does — and
 * the unit tests run it against the real functions for every combination, so
 * the two can't drift apart quietly.
 */
export const INIT_SCRIPT = `(function(){try{
var d=document.documentElement,a={};
try{a=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||"null")||{}}catch(e){}
function pick(list,v,f){return list.indexOf(v)>=0?v:f}
var t=pick(${JSON.stringify(THEMES)},a.theme,"system");
var light=t==="light"||(t==="system"&&!!window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches);
d.setAttribute("data-theme",light?"light":"dark");
d.setAttribute("data-text",pick(${JSON.stringify(TEXT_SIZES)},a.textSize,"normal"));
d.setAttribute("data-density",pick(${JSON.stringify(DENSITIES)},a.density,"comfortable"));
var w=a.sidebarWidth;
w=typeof w==="number"&&isFinite(w)?Math.min(${SIDEBAR_MAX},Math.max(${SIDEBAR_MIN},Math.round(w))):${SIDEBAR_DEFAULT};
d.style.setProperty("--sidebar-w",w+"px");
}catch(e){}})();`;
