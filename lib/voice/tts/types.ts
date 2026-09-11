export interface SpeakOptions {
  voice?: string;
  rate?: number;
  signal?: AbortSignal;
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
}

/**
 * Strip markdown so it isn't read aloud as punctuation soup, and drop code
 * blocks entirely — nobody wants a function read to them character by
 * character. The canvas already shows the code.
 */
export function forSpeech(markdown: string, maxChars = 1200): string {
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
