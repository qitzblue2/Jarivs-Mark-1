/** Fixed phrases shared by the browser and device voice loops. */

export const DEFAULT_GREETING = "Hey sir, how can I help you today?";

/** Phrases that end a conversation and send JARVIS back to waiting. */
export const STOP_WORDS =
  /^\s*(stop|goodbye|good bye|bye|that's all|thats all|exit|nevermind|never mind)\b/i;

/**
 * Things the room says that aren't addressed to anyone.
 *
 * Always-on listening means every cough, "uh", and half-sentence from the
 * television reaches the transcriber. Whisper is confident about all of them,
 * so they arrive as real-looking text; answering each one would make a box in
 * your room unbearable. Anything this short and this empty is dropped without
 * a reply.
 */
const FILLER = /^\s*(uh|um|hmm+|mm+|ah|oh|eh|huh|yeah|yep|ok|okay|hm|so|and|the|you|a)\s*[.,!?]*\s*$/i;

/** Whisper's canonical output for silence and background hiss. */
const HALLUCINATED = /^\s*[\[(]?\s*(blank_audio|silence|music|applause|inaudible|foreign|thanks for watching|subscribe|bleep)\b/i;

/** True when a transcript is noise rather than something said to JARVIS. */
export function isNoise(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  if (HALLUCINATED.test(trimmed)) return true;
  if (FILLER.test(trimmed)) return true;
  // A "sentence" with no letters at all is punctuation the model invented.
  if (!/[a-z]/i.test(trimmed)) return true;
  return false;
}
