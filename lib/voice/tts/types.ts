export interface SpeakOptions {
  voice?: string;
  rate?: number;
  signal?: AbortSignal;
}

/**
 * Audio that has been generated and is ready to play.
 *
 * Returned by `synthesize` so the speaker can generate the next sentence
 * while the current one is still playing. Without this split, every sentence
 * is preceded by its own synthesis pause.
 */
export interface PreparedSpeech {
  play(signal?: AbortSignal): Promise<void>;
  /** Release anything held (blob URLs, buffers). */
  dispose?(): void;
}

export interface TtsEngine {
  id: string;
  label: string;
  isAvailable(): boolean;
  /** Resolves when speech finishes, or rejects if cancelled. */
  speak(text: string, options?: SpeakOptions): Promise<void>;
  cancel(): void;
  /** Selectable voices, if the engine has any. */
  voices(): Promise<{ id: string; label: string }[]>;

  /**
   * Generate audio without playing it, so the speaker can work ahead.
   *
   * Optional: the browser's speechSynthesis does generation and playback in
   * one opaque step and cannot support this, so engines that omit it fall
   * back to the sequential path.
   */
  synthesize?(text: string, options?: SpeakOptions): Promise<PreparedSpeech>;
}

/**
 * Strip markdown so it isn't read aloud as punctuation soup, and drop code
 * blocks entirely — nobody wants a function read to them character by
 * character. The canvas already shows the code.
 *
 * No length limit. There used to be a 1,200-character clip here, which threw
 * away most of any long answer before it reached the engine. It existed only
 * because a single long utterance was unreliable; speech is now chunked into
 * sentences by Speaker, so length is no longer a problem to solve here.
 */
export function forSpeech(markdown: string, maxChars = Infinity): string {
  let text = markdown
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/^\s*[-:|]+\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > maxChars) {
    // Cut at a sentence boundary so it doesn't stop mid-word.
    const clipped = text.slice(0, maxChars);
    const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
    text = `${lastStop > maxChars * 0.5 ? clipped.slice(0, lastStop + 1) : clipped}… the rest is on screen.`;
  }

  return text;
}
