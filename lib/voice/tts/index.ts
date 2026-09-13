import { BrowserTts } from "./browser";
import { GroqTts } from "./groq";
import { KokoroTts, type KokoroQuality } from "./kokoro";
import type { PreparedSpeech, SpeakOptions, TtsEngine } from "./types";

export type { TtsEngine, SpeakOptions } from "./types";
export { forSpeech } from "./types";
export { QUALITY_OPTIONS, type KokoroQuality } from "./kokoro";

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

  /** Model build, chosen in Settings. Changing it re-downloads on next use. */
  setQuality(quality: KokoroQuality): void {
    this.kokoro.setQuality(quality);
    // A different build deserves a fresh attempt even if the last one failed.
    this.failed = false;
  }

  isAvailable(): boolean {
    return this.kokoro.isAvailable();
  }

  voices(): Promise<{ id: string; label: string }[]> {
    return this.failed ? browser.voices() : this.kokoro.voices();
  }

  /**
   * Generate ahead, so the speaker can overlap synthesis with playback.
   *
   * A failure here must not reject: the Speaker would report an error and
   * skip the sentence. Instead it degrades to the browser engine, wrapped as
   * a prepared item so the rest of the reply still gets spoken.
   */
  async synthesize(text: string, options: SpeakOptions = {}): Promise<PreparedSpeech> {
    const viaBrowser: PreparedSpeech = {
      play: (signal) => browser.speak(text, { ...options, voice: undefined, signal }),
    };

    if (this.failed) return viaBrowser;

    const firstRun = !this.kokoro.isLoaded;
    if (firstRun) this.watchDownload();

    try {
      const prepared = await this.kokoro.synthesize(text, options);
      if (firstRun) this.onNotice?.("");
      return prepared;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;

      this.failed = true;
      this.onNotice?.(
        `Couldn't load the Kokoro voice (${(err as Error).message}). Using the browser voice instead.`,
      );
      return viaBrowser;
    }
  }

  private watchDownload(): void {
    this.kokoro.onProgress = (percent) => {
      if (percent >= 99) this.onNotice?.("");
      else this.onNotice?.(`Downloading the voice model… ${Math.round(percent)}%`);
    };
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const prepared = await this.synthesize(text, options);
    await prepared.play(options.signal);
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
