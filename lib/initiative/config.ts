import { parseHhmm } from "@/lib/schedule/due";

/**
 * How much JARVIS may speak first, and how.
 *
 * Everything about interrupting you lives behind these settings, and the
 * defaults are the gentle end: suggestions appear as a small card inside the
 * app, a few an hour at most, never while you are typing, never with sound,
 * never as a desktop notification. Louder is something you turn on.
 *
 * Kept in this browser (like appearance): whether a phone or a desk monitor
 * should interrupt you is not a fact about your account.
 */

export const RULE_IDS = [
  "long-chat",
  "provider-trouble",
  "break",
  "late-night",
  "approval-waiting",
  "welcome-back",
  "remember-offer",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export const RULE_INFO: Record<RuleId, { label: string; blurb: string }> = {
  "long-chat": { label: "A chat is getting long", blurb: "When the context meter is nearly full, offer to summarise or start fresh." },
  "provider-trouble": { label: "A provider keeps failing", blurb: "When replies keep failing, offer another model that is ready." },
  break: { label: "Time for a break", blurb: "After about an hour and a half of steady work." },
  "late-night": { label: "It's late", blurb: "Once a night, if you are still going well past bedtime." },
  "approval-waiting": { label: "Waiting for your OK", blurb: "When JARVIS has asked to write a file or run a command and you haven't answered." },
  "welcome-back": { label: "Welcome back", blurb: "After a long time away, offer to pick up where you left off." },
  "remember-offer": { label: "Remember that?", blurb: "When you mention something lasting about yourself — a name, an allergy — offer to save it to memory." },
};

export const LEVELS = ["quiet", "balanced", "chatty"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_INFO: Record<Level, { label: string; blurb: string }> = {
  quiet: { label: "Quiet", blurb: "Nothing pops up. Suggestions wait in the inbox with a badge." },
  balanced: { label: "Balanced", blurb: "A few an hour, at calm moments." },
  chatty: { label: "Chatty", blurb: "Up to eight an hour." },
};

/** Cards that may appear per hour. Quiet is zero: everything goes to the inbox. */
export const HOURLY_CAP: Record<Level, number> = { quiet: 0, balanced: 3, chatty: 8 };

export interface InitiativeConfig {
  /** The master switch. Off: JARVIS never speaks first (scheduled results still wait in the inbox). */
  enabled: boolean;
  level: Level;
  /** Also a desktop notification when this tab is in the background. Needs the browser's permission. */
  desktop: boolean;
  /** Read cards aloud with the browser's voice. */
  speak: boolean;
  /** No desktop notifications and no speech inside these hours. */
  quietHours: { on: boolean; from: string; to: string };
  rules: Record<RuleId, boolean>;
  /** Notice a frustrated or stressed message, and adjust how JARVIS answers it. */
  adaptTone: boolean;
  /** Show the mood orb. */
  showMood: boolean;
  /** Suggested follow-ups under the last reply. */
  followUps: boolean;
}

export const DEFAULT_CONFIG: InitiativeConfig = {
  enabled: true,
  level: "balanced",
  desktop: false,
  speak: false,
  quietHours: { on: true, from: "22:30", to: "07:00" },
  rules: Object.fromEntries(RULE_IDS.map((id) => [id, true])) as Record<RuleId, boolean>,
  adaptTone: true,
  showMood: true,
  followUps: true,
};

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** Whatever was stored — old, hand-edited, from a newer version — becomes something valid, field by field. */
export function cleanConfig(raw: unknown): InitiativeConfig {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const q = r.quietHours && typeof r.quietHours === "object" ? (r.quietHours as Record<string, unknown>) : {};
  const rules = r.rules && typeof r.rules === "object" ? (r.rules as Record<string, unknown>) : {};
  const time = (value: unknown, fallback: string) => (typeof value === "string" && parseHhmm(value) ? value.trim() : fallback);
  return {
    enabled: bool(r.enabled, DEFAULT_CONFIG.enabled),
    level: LEVELS.includes(r.level as Level) ? (r.level as Level) : DEFAULT_CONFIG.level,
    desktop: bool(r.desktop, DEFAULT_CONFIG.desktop),
    speak: bool(r.speak, DEFAULT_CONFIG.speak),
    quietHours: {
      on: bool(q.on, DEFAULT_CONFIG.quietHours.on),
      from: time(q.from, DEFAULT_CONFIG.quietHours.from),
      to: time(q.to, DEFAULT_CONFIG.quietHours.to),
    },
    rules: Object.fromEntries(RULE_IDS.map((id) => [id, bool(rules[id], true)])) as Record<RuleId, boolean>,
    adaptTone: bool(r.adaptTone, DEFAULT_CONFIG.adaptTone),
    showMood: bool(r.showMood, DEFAULT_CONFIG.showMood),
    followUps: bool(r.followUps, DEFAULT_CONFIG.followUps),
  };
}

/**
 * Whether `now` falls inside the quiet hours, which may wrap midnight
 * ("22:30" to "07:00"). The same two times mean never — an empty window, not a
 * whole day — so an accidental duplicate can't silence everything.
 */
export function inQuietHours(now: Date, quiet: InitiativeConfig["quietHours"]): boolean {
  if (!quiet.on) return false;
  const from = parseHhmm(quiet.from);
  const to = parseHhmm(quiet.to);
  if (!from || !to) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  const start = from.hours * 60 + from.minutes;
  const end = to.hours * 60 + to.minutes;
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
