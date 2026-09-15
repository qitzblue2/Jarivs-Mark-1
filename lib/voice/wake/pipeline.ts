import type { WakeWordDetector } from "./types";

/**
 * The openWakeWord model pipeline, with the runtime left out.
 *
 * The same three models have to run in two places now — onnxruntime-web in
 * the browser, onnxruntime-node on the device — and the interesting part
 * isn't the runtime, it's the sequence: a sliding audio window, a scaling
 * step between mel and embedding that the models were trained with, and a
 * rolling stack of 16 embeddings. Duplicating that for a second runtime
 * would mean two chances to get it subtly wrong and no way to notice, so
 * it lives here once and each runtime supplies three `ModelRunner`s.
 *
 * Shapes confirmed against the released v0.5.1 files:
 *
 *   audio (12640 samples) → melspectrogram → (76, 32)
 *   (76, 32)              → embedding      → (96,)
 *   last 16 embeddings    → hey_jarvis     → score 0-1
 *
 * Each 80 ms frame re-runs melspectrogram over the whole 12640-sample window
 * (790 ms of audio) rather than stitching mel frames incrementally. That is
 * simpler, avoids chunk-boundary artifacts, and costs a few percent of the
 * realtime budget even on a Pi.
 */

const SAMPLE_RATE = 16000;
/** melspectrogram yields samples/160 - 3 frames; 76 frames needs 12640. */
const WINDOW_SAMPLES = 12640;
const MEL_FRAMES = 76;
const MEL_BINS = 32;
const EMBEDDING_DIM = 96;
const EMBEDDING_WINDOW = 16;

/** One single-input, single-output float model, however it is executed. */
export interface ModelRunner {
  run(input: Float32Array, dims: number[]): Promise<Float32Array>;
}

export interface WakeModels {
  mel: ModelRunner;
  embedding: ModelRunner;
  wake: ModelRunner;
}

export class WakeWordPipeline implements WakeWordDetector {
  private models: WakeModels | null = null;
  private loading: Promise<void> | null = null;

  /** Rolling raw audio, newest at the end. */
  private audio = new Float32Array(WINDOW_SAMPLES);
  private primed = 0;

  /** Rolling embeddings, oldest first. */
  private embeddings: Float32Array[] = [];

  constructor(private readonly loader: () => Promise<WakeModels>) {}

  async load(): Promise<void> {
    if (this.models) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      this.models = await this.loader();
    })();

    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  get isLoaded(): boolean {
    return this.models !== null;
  }

  /**
   * Add a frame to the rolling window.
   *
   * Deliberately separate from scoring. Inference can take longer than the
   * 80ms frame interval, and if a slow inference caused the caller to drop
   * frames the window would hold chopped audio — "hey jar…vis" — which the
   * model will never recognise. Buffering is cheap and must never be
   * skipped; only `score()` may be.
   */
  append(frame: Float32Array): void {
    this.audio.copyWithin(0, frame.length);
    this.audio.set(frame, WINDOW_SAMPLES - frame.length);
    this.primed = Math.min(this.primed + frame.length, WINDOW_SAMPLES);
  }

  /** True once enough audio has accumulated to score meaningfully. */
  get isPrimed(): boolean {
    return this.primed >= WINDOW_SAMPLES;
  }

  /** Score whatever is currently in the window. */
  async score(): Promise<number> {
    const models = this.models;
    if (!models) return 0;

    // Don't score on a half-empty buffer — it produces phantom detections.
    if (!this.isPrimed) return 0;

    const mel = await models.mel.run(this.audio, [1, WINDOW_SAMPLES]);

    // openWakeWord applies this transform between melspectrogram and
    // embedding; the embedding model was trained on the scaled values.
    const scaled = new Float32Array(mel.length);
    for (let i = 0; i < mel.length; i++) scaled[i] = mel[i] / 10 + 2;

    const embedding = await models.embedding.run(scaled, [1, MEL_FRAMES, MEL_BINS, 1]);

    this.embeddings.push(new Float32Array(embedding));
    if (this.embeddings.length > EMBEDDING_WINDOW) this.embeddings.shift();
    if (this.embeddings.length < EMBEDDING_WINDOW) return 0;

    const stacked = new Float32Array(EMBEDDING_WINDOW * EMBEDDING_DIM);
    this.embeddings.forEach((e, i) => stacked.set(e, i * EMBEDDING_DIM));

    const score = await models.wake.run(stacked, [1, EMBEDDING_WINDOW, EMBEDDING_DIM]);
    return score[0];
  }

  /** Convenience: buffer then score. Callers that may fall behind should
   *  use append() and score() separately so audio is never lost. */
  async push(frame: Float32Array): Promise<number> {
    this.append(frame);
    return this.score();
  }

  reset(): void {
    this.audio.fill(0);
    this.primed = 0;
    this.embeddings = [];
  }

  dispose(): void {
    this.reset();
    this.models = null;
  }
}

export const WAKE_CONSTANTS = {
  SAMPLE_RATE,
  WINDOW_SAMPLES,
  MEL_FRAMES,
  MEL_BINS,
  EMBEDDING_DIM,
  EMBEDDING_WINDOW,
};
