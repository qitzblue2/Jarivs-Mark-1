/**
 * Turns a stream of speech probabilities into whole utterances.
 *
 * Pure on purpose. Always-on listening means this class decides, dozens of
 * times a minute, whether you were talking to JARVIS or just talking — and
 * the failure modes (cutting you off mid-sentence, recording the room for
 * thirty seconds, firing on a cough) are all timing, not acoustics. Keeping
 * it free of ONNX and audio hardware means those edges can actually be
 * tested.
 *
 * One window is 512 samples at 16 kHz — 32 ms.
 */

export const WINDOW_MS = 32;

export interface SegmenterOptions {
  /** Probability at which a window counts as speech. */
  positiveThreshold?: number;
  /** Lower bar to *stay* in speech; hysteresis stops rapid flapping. */
  negativeThreshold?: number;
  /** Quiet windows before the turn is over. 22 ≈ 700 ms. */
  redemptionWindows?: number;
  /** Utterances shorter than this are coughs and chair creaks. 5 ≈ 160 ms. */
  minSpeechWindows?: number;
  /** Audio kept from before detection, so the first syllable survives. */
  preSpeechWindows?: number;
  /** Hard cap, so a television can't hold the turn open forever. */
  maxSpeechWindows?: number;
}

export type SegmentEvent =
  | { type: "none" }
  | { type: "start" }
  | { type: "end"; audio: Float32Array; windows: number; capped: boolean }
  /** Speech that stopped before it was long enough to mean anything. */
  | { type: "discard"; windows: number };

export class SpeechSegmenter {
  private readonly positive: number;
  private readonly negative: number;
  private readonly redemption: number;
  private readonly minSpeech: number;
  private readonly preSpeech: number;
  private readonly maxSpeech: number;

  private speaking = false;
  private quiet = 0;
  private collected: Float32Array[] = [];
  /** Rolling pre-roll, only used while not speaking. */
  private preRoll: Float32Array[] = [];

  constructor(options: SegmenterOptions = {}) {
    this.positive = options.positiveThreshold ?? 0.5;
    this.negative = options.negativeThreshold ?? 0.35;
    this.redemption = options.redemptionWindows ?? 22;
    this.minSpeech = options.minSpeechWindows ?? 5;
    this.preSpeech = options.preSpeechWindows ?? 8;
    this.maxSpeech = options.maxSpeechWindows ?? 940;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  push(probability: number, window: Float32Array): SegmentEvent {
    if (!this.speaking) {
      if (probability < this.positive) {
        this.preRoll.push(window);
        if (this.preRoll.length > this.preSpeech) this.preRoll.shift();
        return { type: "none" };
      }

      this.speaking = true;
      this.quiet = 0;
      this.collected = [...this.preRoll, window];
      this.preRoll = [];
      return { type: "start" };
    }

    this.collected.push(window);
    if (probability < this.negative) this.quiet++;
    else this.quiet = 0;

    if (this.quiet >= this.redemption) return this.finish(false);
    if (this.collected.length >= this.maxSpeech) return this.finish(true);
    return { type: "none" };
  }

  /** End the turn now — used when the caller stops listening mid-utterance. */
  flush(): SegmentEvent {
    if (!this.speaking) return { type: "none" };
    return this.finish(false);
  }

  private finish(capped: boolean): SegmentEvent {
    const windows = this.collected;
    // The quiet actually observed, not the configured redemption: a turn
    // ended by flush() or by the cap has barely any trailing silence, and
    // assuming a full redemption there made short real speech look like a
    // blip and threw it away.
    const quiet = this.quiet;

    this.speaking = false;
    this.quiet = 0;
    this.collected = [];
    this.preRoll = [];

    if (windows.length - quiet < this.minSpeech) {
      return { type: "discard", windows: windows.length };
    }

    // Trailing silence is dead weight in the upload; keep a little so the
    // last word isn't clipped, drop the rest.
    const keepTail = 4;
    const trailing = Math.max(0, quiet - keepTail);
    const kept = trailing > 0 ? windows.slice(0, Math.max(1, windows.length - trailing)) : windows;

    const total = kept.reduce((n, w) => n + w.length, 0);
    const audio = new Float32Array(total);
    let offset = 0;
    for (const w of kept) {
      audio.set(w, offset);
      offset += w.length;
    }

    return { type: "end", audio, windows: kept.length, capped };
  }

  reset(): void {
    this.speaking = false;
    this.quiet = 0;
    this.collected = [];
    this.preRoll = [];
  }
}
