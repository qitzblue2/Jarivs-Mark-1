import type { MoodEvent } from "./mood";

/**
 * Reading the tone of what you wrote, so the answer can fit it.
 *
 * Crude on purpose and entirely local: a handful of phrases and patterns, run in
 * the browser on a message as you send it, and thrown away. Nothing about it is
 * stored or logged, and what reaches the model is one sentence of style
 * guidance for that turn ("keep it short, fix it first") — never a label for
 * you. It will sometimes be wrong; the cost of being wrong is a slightly
 * shorter or warmer reply.
 *
 * It is not a safety system. The "distress" tone only makes the reply gentler
 * and points toward real help; it does not detect danger, and nothing here
 * replaces a person.
 */
export const TONES = ["neutral", "frustrated", "stressed", "excited", "grateful", "sad", "distress"] as const;
export type Tone = (typeof TONES)[number];

/** For the server, which takes the tone's name and looks the sentence up itself rather than accepting one. */
export const isTone = (value: unknown): value is Tone => typeof value === "string" && (TONES as readonly string[]).includes(value);

/** Pasted logs and files are not a mood: only short, hand-written messages are read. */
const MAX_CHARS = 600;
const MAX_LINES = 8;

const DISTRESS =
  /\b(kill myself|killing myself|end my life|want to die|wanna die|suicid(?:e|al)|self[- ]?harm|hurt myself|no reason to live|better off dead|can'?t go on (?:living|like this|anymore))\b/;
const SAD =
  /\b(i feel (?:so |really )?(?:sad|lonely|empty|hopeless|worthless|down|depressed)|i'?m (?:so |really )?(?:sad|lonely|depressed|heartbroken|miserable)|feeling (?:sad|lonely|down|depressed)|i miss (?:him|her|them|my))\b/;
const FRUSTRATED =
  /\b(still (?:not )?(?:working|broken|failing|wrong|doesn'?t)|doesn'?t work|not working|isn'?t working|won'?t work|keeps? (?:failing|crashing|breaking)|useless|wtf|ugh+|argh+|so annoying|this is (?:ridiculous|stupid|broken|terrible)|i give up|fed up|again\?!)\b/;
const STRESSED =
  /\b(deadline (?:is )?(?:today|tomorrow|tonight|tight|looming)|(?:tight|looming|impossible) deadline|asap|urgent(?:ly)?|emergency|panick?(?:ing)?|overwhelmed|stressed|running out of time|due (?:today|tomorrow|tonight|in an hour)|need this (?:now|today|fast))\b/;
const GRATEFUL =
  /\b(thanks?|thank you|thx|cheers|appreciate (?:it|that)|perfect|brilliant|you'?re (?:the best|amazing|awesome)|great job|nice one|works (?:great|perfectly))\b/;
const EXCITED = /\b(awesome|amazing|can'?t wait|so (?:cool|excited)|love it|let'?s go|yay|woohoo|fantastic)\b/;

/** Mostly capitals, in a message long enough for that to mean something. */
function shouting(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  return letters.length >= 12 && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.7;
}

export function readTone(text: string): Tone {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_CHARS || trimmed.split("\n").length > MAX_LINES) return "neutral";
  if (/```/.test(trimmed)) return "neutral";

  const lower = trimmed.toLowerCase();
  if (DISTRESS.test(lower)) return "distress";
  if (SAD.test(lower)) return "sad";
  if (FRUSTRATED.test(lower) || shouting(trimmed) || /!{3,}/.test(trimmed) && !GRATEFUL.test(lower) && !EXCITED.test(lower)) return "frustrated";
  if (STRESSED.test(lower)) return "stressed";
  if (GRATEFUL.test(lower)) return "grateful";
  if (EXCITED.test(lower) || /!{2,}/.test(trimmed)) return "excited";
  return "neutral";
}

/** One sentence of guidance for the turn, or null when the tone needs none. */
export function toneHint(tone: Tone): string | null {
  switch (tone) {
    case "frustrated":
      return "The user sounds frustrated. Acknowledge it in half a sentence, then fix the problem directly: no preamble, no lecture, one clear next step.";
    case "stressed":
      return "The user is under time pressure. Lead with the fastest working answer, keep it short, and offer detail afterwards.";
    case "sad":
      return "The user may be feeling low. Be warm and unhurried; don't rush to fix or diagnose, and don't joke.";
    case "distress":
      return "The user may be in distress. Respond with care, without judgement or humour. If they might act on what they are saying, encourage them to reach out to someone they trust or to local emergency or crisis services. Don't lecture; ask how they are.";
    default:
      return null;
  }
}

/** What reading a tone does to JARVIS's mood. Sad and distress touch nothing — it isn't a moment for a mood to perform. */
export function toneMoodEvent(tone: Tone): MoodEvent | null {
  switch (tone) {
    case "frustrated":
      return "frustration";
    case "stressed":
      return "stress";
    case "grateful":
      return "thanked";
    default:
      return null;
  }
}

/** How long to keep suggestions and nudges away after a tone that calls for quiet. */
export function quietFor(tone: Tone): number {
  if (tone === "distress") return 6 * 3_600_000;
  if (tone === "sad") return 2 * 3_600_000;
  return 0;
}
