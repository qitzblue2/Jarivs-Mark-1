import type { PreparedSpeech, SpeakOptions, TtsEngine } from "../tts/types";
import { PIPER_VOICES, piperStatus, synthesize } from "./piper";
import { play } from "./audio";

/**
 * Piper wired up as a `TtsEngine`.
 *
 * Doing it this way means the device gets the sentence pipelining for free:
 * `Speaker` already splits a streaming reply into sentences and synthesises
 * two ahead of playback, which is the difference between JARVIS starting to
 * answer in half a second and starting after the whole paragraph is ready.
 * That logic shouldn't exist twice.
 */
export class PiperTts implements TtsEngine {
  id = "piper";
  label = "Piper (on-device)";

  /** Cached so the sync `isAvailable` has something honest to report. */
  private installed: boolean | null = null;
  private playing: AbortController | null = null;

  /** Probe once at startup so status is known before the first sentence. */
  async check(): Promise<boolean> {
    this.installed = (await piperStatus()).installed;
    return this.installed;
  }

  isAvailable(): boolean {
    // Unknown until checked; claiming unavailable would hide a working setup.
    return this.installed !== false;
  }

  async voices(): Promise<{ id: string; label: string }[]> {
    const status = await piperStatus();
    return PIPER_VOICES.filter((v) => status.voices.some((file) => file.startsWith(v.id))).map(
      (v) => ({ id: v.id, label: v.label }),
    );
  }

  async synthesize(text: string, options: SpeakOptions = {}): Promise<PreparedSpeech> {
    const { wav } = await synthesize(text, {
      voice: options.voice,
      speed: options.rate,
      signal: options.signal,
    });

    return {
      play: async (signal) => {
        const controller = new AbortController();
        this.playing = controller;
        const stop = () => controller.abort();
        signal?.addEventListener("abort", stop, { once: true });

        try {
          await play(wav, controller.signal);
        } finally {
          signal?.removeEventListener("abort", stop);
          if (this.playing === controller) this.playing = null;
        }
      },
    };
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const prepared = await this.synthesize(text, options);
    await prepared.play(options.signal);
  }

  /** Barge-in: kill whatever `aplay` is currently holding the speaker. */
  cancel(): void {
    this.playing?.abort();
    this.playing = null;
  }
}
