import { BrowserTts } from "./browser";
import { GroqTts } from "./groq";
import type { TtsEngine } from "./types";

export type { TtsEngine, SpeakOptions } from "./types";
export { forSpeech } from "./types";

const ENGINES: Record<string, TtsEngine> = {
  browser: new BrowserTts(),
  groq: new GroqTts(),
};

export function ttsEngines(): TtsEngine[] {
  return Object.values(ENGINES);
}

/** Falls back to the browser engine, which is always available. */
export function getTts(id: string): TtsEngine {
  return ENGINES[id] ?? ENGINES.browser;
}
