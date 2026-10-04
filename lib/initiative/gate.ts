import { HOURLY_CAP, RULE_IDS, type InitiativeConfig, type RuleId } from "./config";
import type { Nudge, NudgeRule } from "./rules";

/**
 * Whether a card may appear *now*. Finding something to say is cheap; knowing
 * when to keep quiet is the part that makes it bearable, so it is all here, in
 * one pure function with its reasons spelled out and tested.
 *
 * In order, the first that applies wins:
 *   - off, muted, or snoozed       → drop      (it never existed)
 *   - distress in what you wrote   → drop      (a card is the last thing wanted)
 *   - the same thing, recently     → drop
 *   - focus timer running          → inbox     (a badge, not a card)
 *   - level "quiet"                → inbox
 *   - hourly cap used up           → inbox     (unless you asked for it)
 *   - typing, streaming, a dialog, voice mode → queue (try again at a calm moment)
 *   - otherwise                    → show
 */

export interface GateState {
  /** When cards appeared in the last hour. */
  shown: number[];
  lastByRule: Record<string, number>;
  snoozedUntil: Record<string, number>;
  /** When each rule's cards were dismissed, last week. */
  dismissals: Record<string, number[]>;
  /** Rules muted because they were dismissed again and again. */
  learnedMutes: RuleId[];
}

export const EMPTY_GATE: GateState = { shown: [], lastByRule: {}, snoozedUntil: {}, dismissals: {}, learnedMutes: [] };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The same rule is not raised again within this long — however often the condition holds. */
export const COOLDOWN_MS: Record<NudgeRule, number> = {
  "long-chat": 30 * MINUTE,
  "provider-trouble": 10 * MINUTE,
  break: 90 * MINUTE,
  "late-night": 8 * HOUR,
  "approval-waiting": 5 * MINUTE,
  "welcome-back": 4 * HOUR,
  "remember-offer": 2 * MINUTE,
  "focus-over": 0,
  inbox: 0,
};

export const SNOOZE_MS = HOUR;
/** Dismissing a rule's cards this many times in a week mutes it. */
export const MUTE_AFTER = 3;
const MUTE_WINDOW_MS = 7 * DAY;

export interface Situation {
  now: number;
  /** You've typed in the last few seconds. */
  typing: boolean;
  streaming: boolean;
  dialogOpen: boolean;
  voiceOpen: boolean;
  /** This tab is in the background. */
  hidden: boolean;
  focusUntil: number;
  /** After a tone that calls for quiet: nothing until then. */
  distressUntil: number;
}

export type Decision = { action: "show" | "queue" | "inbox" | "drop"; reason: string };

const isRule = (rule: NudgeRule): rule is RuleId => (RULE_IDS as readonly string[]).includes(rule);

export function ruleEnabled(config: InitiativeConfig, gate: GateState, rule: NudgeRule): boolean {
  if (!isRule(rule)) return true; // yours, not a suggestion
  return config.rules[rule] && !gate.learnedMutes.includes(rule);
}

export function decide(nudge: Nudge, config: InitiativeConfig, gate: GateState, sit: Situation): Decision {
  if (!config.enabled) return { action: nudge.requested ? "inbox" : "drop", reason: "off" };
  if (!ruleEnabled(config, gate, nudge.rule)) return { action: "drop", reason: "muted" };
  if ((gate.snoozedUntil[nudge.rule] ?? 0) > sit.now) return { action: "drop", reason: "snoozed" };
  if (sit.distressUntil > sit.now) return { action: nudge.requested ? "inbox" : "drop", reason: "quiet after a hard message" };

  const last = gate.lastByRule[nudge.rule];
  if (last !== undefined && sit.now - last < COOLDOWN_MS[nudge.rule]) return { action: "drop", reason: "recently offered" };

  if (sit.focusUntil > sit.now) return { action: "inbox", reason: "focus" };
  if (config.level === "quiet") return { action: "inbox", reason: "quiet level" };

  if (!nudge.requested) {
    const lastHour = gate.shown.filter((t) => sit.now - t < HOUR).length;
    if (lastHour >= HOURLY_CAP[config.level]) return { action: "inbox", reason: "hourly limit" };
  }

  if (sit.typing) return { action: "queue", reason: "you are typing" };
  if (sit.streaming) return { action: "queue", reason: "a reply is arriving" };
  if (sit.dialogOpen) return { action: "queue", reason: "a dialog is open" };
  if (sit.voiceOpen) return { action: "queue", reason: "voice mode" };
  return { action: "show", reason: "calm moment" };
}

/** Whether to also use the louder channels for a card that is being shown. */
export function channels(config: InitiativeConfig, sit: Pick<Situation, "hidden">, inQuiet: boolean): { desktop: boolean; speak: boolean } {
  return {
    desktop: config.desktop && sit.hidden && !inQuiet,
    speak: config.speak && !sit.hidden && !inQuiet,
  };
}

function prune(gate: GateState, now: number): GateState {
  const dismissals: Record<string, number[]> = {};
  for (const [rule, times] of Object.entries(gate.dismissals)) {
    const recent = times.filter((t) => now - t < MUTE_WINDOW_MS);
    if (recent.length) dismissals[rule] = recent;
  }
  return { ...gate, shown: gate.shown.filter((t) => now - t < HOUR), dismissals };
}

export function recordShown(gate: GateState, nudge: Nudge, now: number): GateState {
  const pruned = prune(gate, now);
  return {
    ...pruned,
    // A card you asked for doesn't use up the allowance meant for unprompted ones.
    shown: nudge.requested ? pruned.shown : [...pruned.shown, now],
    lastByRule: { ...pruned.lastByRule, [nudge.rule]: now },
  };
}

/** You waved a card away: quiet for that rule for an hour, and a third time in a week mutes it. */
export function recordDismissal(gate: GateState, rule: NudgeRule, now: number): { gate: GateState; mutedNow: boolean } {
  const pruned = prune(gate, now);
  const times = [...(pruned.dismissals[rule] ?? []), now];
  const mute = isRule(rule) && times.length >= MUTE_AFTER && !pruned.learnedMutes.includes(rule);
  return {
    mutedNow: mute,
    gate: {
      ...pruned,
      dismissals: { ...pruned.dismissals, [rule]: times },
      snoozedUntil: { ...pruned.snoozedUntil, [rule]: now + SNOOZE_MS },
      learnedMutes: mute ? [...pruned.learnedMutes, rule as RuleId] : pruned.learnedMutes,
    },
  };
}

/** You used a card: a good sign, so what it counted against the rule is forgiven. */
export function recordAccepted(gate: GateState, rule: NudgeRule): GateState {
  const { [rule]: _gone, ...dismissals } = gate.dismissals;
  const { [rule]: _snooze, ...snoozedUntil } = gate.snoozedUntil;
  return { ...gate, dismissals, snoozedUntil };
}

/** "Stop suggesting this", or turning the rule back on in Settings, clears what was learned about it. */
export function forgetRule(gate: GateState, rule: RuleId): GateState {
  const { [rule]: _a, ...dismissals } = gate.dismissals;
  const { [rule]: _b, ...snoozedUntil } = gate.snoozedUntil;
  return { ...gate, dismissals, snoozedUntil, learnedMutes: gate.learnedMutes.filter((r) => r !== rule) };
}
