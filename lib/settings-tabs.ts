/**
 * Settings used to be one long page; these are the tabs it is now split into.
 * Which tab a section belongs to is worked out from the section itself (a
 * marker attribute it already carries, else its heading), so adding a section
 * somewhere never needs a second list updated — and an unrecognised one lands
 * on "Assistant" rather than disappearing.
 */
export const SETTINGS_TABS = [
  { id: "models", label: "Keys & models" },
  { id: "personality", label: "Personality" },
  { id: "pictures", label: "Pictures" },
  { id: "assistant", label: "Assistant" },
  { id: "look", label: "Look" },
  { id: "data", label: "Data & about" },
  // The long single page, for anyone who preferred it.
  { id: "all", label: "Everything" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];
export const isSettingsTab = (v: unknown): v is SettingsTab => SETTINGS_TABS.some((t) => t.id === v);
export const DEFAULT_SETTINGS_TAB: SettingsTab = "models";
export const SETTINGS_TAB_KEY = "jarvis.settings-tab";

const BY_ATTRIBUTE: [string, SettingsTab][] = [
  ["data-model-settings", "models"],
  ["data-tool-settings", "models"],
  ["data-personality-settings", "personality"],
  ["data-image-settings", "pictures"],
  ["data-appearance", "look"],
  ["data-look-settings", "look"],
  ["data-prefs-settings", "assistant"],
  ["data-initiative-settings", "assistant"],
  ["data-data-settings", "data"],
  ["data-about-settings", "data"],
];

const BY_HEADING: [RegExp, SettingsTab][] = [
  [/api keys|temperature|tool use|fallback/i, "models"],
  [/persona|personality|instructions/i, "personality"],
  [/picture|image/i, "pictures"],
  [/memory|backup|storage/i, "data"],
  [/voice|room display|this machine|scheduled|prompts/i, "assistant"],
];

export function tabForSection(info: { attributes: string[]; heading: string; text: string }): SettingsTab {
  for (const [attr, tab] of BY_ATTRIBUTE) if (info.attributes.includes(attr)) return tab;
  const label = info.heading.trim() || info.text.trim().slice(0, 40);
  for (const [re, tab] of BY_HEADING) if (re.test(label)) return tab;
  return "assistant";
}

/** The next tab for an arrow key; Home and End jump to the ends. Anything else is no move. */
export function nextTab(current: SettingsTab, key: string): SettingsTab | null {
  const i = SETTINGS_TABS.findIndex((t) => t.id === current);
  if (key === "ArrowRight" || key === "ArrowDown") return SETTINGS_TABS[(i + 1) % SETTINGS_TABS.length].id;
  if (key === "ArrowLeft" || key === "ArrowUp") return SETTINGS_TABS[(i - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length].id;
  if (key === "Home") return SETTINGS_TABS[0].id;
  if (key === "End") return SETTINGS_TABS[SETTINGS_TABS.length - 1].id;
  return null;
}
