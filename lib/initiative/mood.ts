/**
 * JARVIS's mood: a small, readable summary of how the session has been going.
 *
 * To be plain about what this is: an expression layer, not a feeling. Two
 * numbers — how good things are going (valence) and how worked-up the session
 * is (energy) — move when things happen: a 👍, a thank-you, a failed request, a
 * reply you sent back for another try. They drift back to calm on their own. The
 * result is a word and a colour that a person can read at a glance, and a tone
 * for the things JARVIS volunteers. Nothing here is sent to a model or a server.
 */

export type MoodLabel = "calm" | "focused" | "pleased" | "delighted" | "concerned" | "apologetic";

export interface Mood {
  /** -1 (things are going badly) … 1 (going well). */
  valence: number;
  /** 0 (idle) … 1 (a busy, tense stretch). */
  energy: number;
  /** What last pushed it below zero: your reply being off (apologetic) or the situation (concerned). */
  cause: "reply" | "situation" | null;
  /** When these numbers were last true, for drifting back toward calm. */
  at: number;
}

export const CALM_ENERGY = 0.3;
/** Half the distance back to calm every ten minutes. */
export const HALF_LIFE_MS = 10 * 60_000;

export const CALM: Mood = { valence: 0, energy: CALM_ENERGY, cause: null, at: 0 };

export type MoodEvent =
  | "thumbs-up"
  | "thumbs-down"
  | "regenerated"
  | "thanked"
  | "frustration"
  | "stress"
  | "reply-ok"
  | "reply-failed"
  | "tool-failed"
  | "focus-done"
  | "new-chat"
  | "late-night";

const EFFECTS: Record<MoodEvent, { valence: number; energy: number; cause?: Mood["cause"] }> = {
  "thumbs-up": { valence: 0.35, energy: 0.1 },
  thanked: { valence: 0.3, energy: 0.05 },
  "thumbs-down": { valence: -0.4, energy: 0.1, cause: "reply" },
  regenerated: { valence: -0.2, energy: 0.05, cause: "reply" },
  frustration: { valence: -0.15, energy: 0.3, cause: "situation" },
  stress: { valence: -0.1, energy: 0.25, cause: "situation" },
  "reply-ok": { valence: 0.08, energy: 0.12 },
  "reply-failed": { valence: -0.2, energy: 0.1, cause: "situation" },
  "tool-failed": { valence: -0.1, energy: 0.05, cause: "situation" },
  "focus-done": { valence: 0.4, energy: -0.2 },
  "new-chat": { valence: 0, energy: 0 },
  "late-night": { valence: 0, energy: -0.2 },
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** The mood `now`: the numbers drifted toward calm for however long it has been. */
export function decay(mood: Mood, now: number): Mood {
  const elapsed = Math.max(0, now - mood.at);
  const keep = 0.5 ** (elapsed / HALF_LIFE_MS);
  const valence = mood.valence * keep;
  return {
    valence,
    energy: CALM_ENERGY + (mood.energy - CALM_ENERGY) * keep,
    // Once it has settled, what it was about no longer matters.
    cause: Math.abs(valence) < 0.05 ? null : mood.cause,
    at: now,
  };
}

export function applyEvent(mood: Mood, event: MoodEvent, now: number): Mood {
  const current = decay(mood, now);
  // A fresh chat is a fresh start: halfway back, whatever happened before.
  if (event === "new-chat") {
    return { valence: current.valence / 2, energy: CALM_ENERGY + (current.energy - CALM_ENERGY) / 2, cause: current.cause, at: now };
  }
  const effect = EFFECTS[event];
  return {
    valence: clamp(current.valence + effect.valence, -1, 1),
    energy: clamp(current.energy + effect.energy, 0, 1),
    cause: effect.valence < 0 ? (effect.cause ?? current.cause) : current.cause,
    at: now,
  };
}

export function labelOf(mood: Mood): MoodLabel {
  if (mood.valence >= 0.6) return "delighted";
  if (mood.valence >= 0.25) return "pleased";
  if (mood.valence <= -0.25) return mood.cause === "reply" ? "apologetic" : "concerned";
  if (mood.energy >= 0.55) return "focused";
  return "calm";
}

export const MOOD_WORD: Record<MoodLabel, string> = {
  calm: "calm",
  focused: "focused",
  pleased: "pleased",
  delighted: "delighted",
  concerned: "concerned",
  apologetic: "sorry",
};

/** For the tooltip and screen readers — worded as a summary of the session, not a claim of feeling. */
export function moodSummary(label: MoodLabel): string {
  switch (label) {
    case "delighted":
      return "Things are going very well.";
    case "pleased":
      return "Things are going well.";
    case "focused":
      return "A busy stretch — keeping up.";
    case "concerned":
      return "Something's been going wrong.";
    case "apologetic":
      return "A recent reply missed the mark.";
    default:
      return "Nothing in particular.";
  }
}
