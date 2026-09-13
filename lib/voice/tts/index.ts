import { BrowserTts } from "./browser";
import { GroqTts } from "./groq";
import { KokoroTts } from "./kokoro";
import type { SpeakOptions, TtsEngine } from "./types";

export type { TtsEngine, SpeakOptions } from "./types";
export { forSpeech } from "./types";

const browser = new BrowserTts();

/**
 * Kokoro wrapped so a failure degrades instead of silencing voice entirely.
 *
 * The model is a large first-run download over a network that might not
 * cooperate. If it can't load, speech falls through to the browser engine and
 * the caller is told why — losing the nicer voice is annoying, losing voice
 * altogether is a broken feature.
 */
class KokoroWithFallback implements TtsEngine {
  id = "kokoro";
  label = "Kokoro (natural, local)";

  private kokoro = new KokoroTts();
  private failed = false;

  /** Set by the UI to surface the first-run download and any fallback. */
  onNotice?: (message: string) => void;

  isAvailable(): boolean {
    return this.kokoro.isAvailable();
  }

  voices(): Promise<{ id: string; label: string }[]> {
    return this.failed ? browser.voices() : this.kokoro.voices();
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    if (this.failed) return browser.speak(text, { ...options, voice: undefined });

    const firstRun = !this.kokoro.isLoaded;
    if (firstRun) {
      this.kokoro.onProgress = (percent) => {
        if (percent >= 99) this.onNotice?.("");
        else this.onNotice?.(`Downloading the voice model… ${Math.round(percent)}%`);
      };
    }

    try {
      await this.kokoro.speak(text, options);
      if (firstRun) this.onNotice?.("");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;

      this.failed = true;
      this.onNotice?.(
        `Couldn't load the Kokoro voice (${(err as Error).message}). Using the browser voice instead.`,
      );
      await browser.speak(text, { ...options, voice: undefined });
    }
  }

  cancel(): void {
    this.kokoro.cancel();
    browser.cancel();
  }
}

export const kokoroEngine = new KokoroWithFallback();

const ENGINES: Record<string, TtsEngine> = {
  kokoro: kokoroEngine,
  browser,
  groq: new GroqTts(),
};

export function ttsEngines(): TtsEngine[] {
  return Object.values(ENGINES);
}

/** Falls back to the browser engine, which is always available. */
export function getTts(id: string): TtsEngine {
  return ENGINES[id] ?? ENGINES.browser;
}
