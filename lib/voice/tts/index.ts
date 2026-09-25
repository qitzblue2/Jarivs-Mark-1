import { BrowserTts } from "./browser";
import { GroqTts } from "./groq";
import { KokoroTts, type KokoroQuality } from "./kokoro";
import type { PreparedSpeech, SpeakOptions, TtsEngine } from "./types";

export type { TtsEngine, SpeakOptions } from "./types";
export { forSpeech } from "./types";
export { QUALITY_OPTIONS, type KokoroQuality } from "./kokoro";

const browser = new BrowserTts();

/**
 * Kokoro wrapped so a failure is explained rather than disguised.
 *
 * The weights are served from this origin now (setup-voice.mjs fetches them),
 * so the common failure is simply that the install step hasn't run. When that
 * happens the caller is told exactly that, once, and JARVIS stays silent for a
 * minute before trying again — it does NOT quietly switch to another voice.
 */
/**
 * How long to stop retrying Kokoro after it fails to load.
 *
 * Long enough that a five-sentence reply doesn't attempt an 86MB load five
 * times, short enough that the next thing you say tries again. This used to be
 * a permanent flag, which meant one stumble muted the good voice for the whole
 * session.
 */
const RETRY_AFTER_MS = 60_000;

class KokoroWithFallback implements TtsEngine {
  id = "kokoro";
  label = "Kokoro (natural, local)";

  private kokoro = new KokoroTts();
  private failedUntil = 0;

  /** Set by the UI to surface the first-run download and any fallback. */
  onNotice?: (message: string) => void;

  /** Model build, chosen in Settings. Changing it re-downloads on next use. */
  setQuality(quality: KokoroQuality): void {
    this.kokoro.setQuality(quality);
    // A different build deserves a fresh attempt even if the last one failed.
    this.failedUntil = 0;
  }

  isAvailable(): boolean {
    return this.kokoro.isAvailable();
  }

  voices(): Promise<{ id: string; label: string }[]> {
    return this.kokoro.voices();
  }

  /**
   * Generate ahead, so the speaker can overlap synthesis with playback.
   *
   * There is deliberately no fallback engine here. This one used to degrade to
   * the browser's speechSynthesis, which on Chrome is a Google voice — a cloud
   * dependency arriving by accident in the feature chosen specifically for not
   * having one. Silence with a reason beats a voice you did not pick; the
   * reply is on screen either way, and the browser engine is still selectable
   * in Settings for anyone who wants it.
   */
  async synthesize(text: string, options: SpeakOptions = {}): Promise<PreparedSpeech> {
    // Inside the cooldown, stay quiet rather than throwing again: Speaker
    // reports every rejection, and one failure should not produce an error per
    // sentence for the rest of the answer.
    if (Date.now() < this.failedUntil) return { play: async () => {} };

    const firstRun = !this.kokoro.isLoaded;
    if (firstRun) this.watchDownload();

    try {
      const prepared = await this.kokoro.synthesize(text, options);
      if (firstRun) this.onNotice?.("");
      return prepared;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;

      this.failedUntil = Date.now() + RETRY_AFTER_MS;
      this.onNotice?.(
        `The Kokoro voice didn't load (${(err as Error).message}). ` +
          "Run `npm run setup:voice` to fetch it. Answers still appear on screen.",
      );
      // Thrown once, so the first failure is visible; later chunks take the
      // silent path above.
      throw err;
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
