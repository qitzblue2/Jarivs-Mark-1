import type { WakeWordDetector } from "./types";

/**
 * onnxruntime is imported lazily, never at module scope.
 *
 * The package resolves its wasm asset paths when it is first evaluated, which
 * throws "Invalid URL" under server rendering — and this module is reachable
 * from the page's component tree, so a static import 500s the whole app
 * before any of it is even used.
 *
 * The wasm-only bundle is deliberate too: the default entry pulls the JSEP
 * (WebGPU) build, a 28MB binary rather than 14MB, which we have no use for.
 */
type Ort = typeof import("onnxruntime-web/wasm");
let ort: Ort | null = null;

async function loadRuntime(): Promise<Ort> {
  if (ort) return ort;
  ort = await import("onnxruntime-web/wasm");
  // Serve the wasm locally and stay single-threaded: multi-threaded wasm
  // needs COOP/COEP cross-origin isolation, which would constrain the whole
  // app for no benefit at this workload.
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  return ort;
}

/**
 * openWakeWord "hey jarvis", running entirely in the browser.
 *
 * Three ONNX models in sequence, with shapes confirmed against the released
 * v0.5.1 files:
 *
 *   audio (12640 samples) → melspectrogram → (76, 32)
 *   (76, 32)              → embedding      → (96,)
 *   last 16 embeddings    → hey_jarvis     → score 0-1
 *
 * Each 80 ms frame re-runs melspectrogram over a sliding 12640-sample window
 * (790 ms of audio) rather than stitching mel frames incrementally. That is
 * simpler and avoids chunk-boundary artifacts, and measures at roughly 4% of
 * the realtime budget — there is no reason to optimise it.
 *
 * Nothing here touches the network after load: detection is fully local, so
 * your microphone audio never leaves the machine until the wake word fires.
 */

const SAMPLE_RATE = 16000;
/** melspectrogram yields samples/160 - 3 frames; 76 frames needs 12640. */
const WINDOW_SAMPLES = 12640;
const MEL_FRAMES = 76;
const MEL_BINS = 32;
const EMBEDDING_DIM = 96;
const EMBEDDING_WINDOW = 16;

const MODEL_BASE = "/models/wake";

type Session = Awaited<ReturnType<Ort["InferenceSession"]["create"]>>;

export class OpenWakeWord implements WakeWordDetector {
  private melModel: Session | null = null;
  private embModel: Session | null = null;
  private wakeModel: Session | null = null;

  /** Rolling raw audio, newest at the end. */
  private audio = new Float32Array(WINDOW_SAMPLES);
  private primed = 0;

  /** Rolling embeddings, oldest first. */
  private embeddings: Float32Array[] = [];

  private loading: Promise<void> | null = null;

  async load(): Promise<void> {
    if (this.melModel) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const runtime = await loadRuntime();
      const options = {
        executionProviders: ["wasm" as const],
        graphOptimizationLevel: "all" as const,
      };

      [this.melModel, this.embModel, this.wakeModel] = await Promise.all([
        runtime.InferenceSession.create(`${MODEL_BASE}/melspectrogram.onnx`, options),
        runtime.InferenceSession.create(`${MODEL_BASE}/embedding_model.onnx`, options),
        runtime.InferenceSession.create(`${MODEL_BASE}/hey_jarvis_v0.1.onnx`, options),
      ]);
    })();

    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /**
   * Add a frame to the rolling window.
   *
   * Deliberately separate from scoring. Inference in wasm can take longer
   * than the 80ms frame interval, and if a slow inference caused the caller
   * to drop frames, the window would end up holding chopped audio —
   * "hey jar…vis" — which the model will never recognise. Buffering is cheap
   * and must never be skipped; only `score()` may be.
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
    if (!this.melModel || !this.embModel || !this.wakeModel || !ort) return 0;
    const { Tensor } = ort;

    // Don't score on a half-empty buffer — it produces phantom detections.
    if (!this.isPrimed) return 0;

    const melOut = await this.melModel.run({
      input: new Tensor("float32", this.audio, [1, WINDOW_SAMPLES]),
    });
    const mel = Object.values(melOut)[0].data as Float32Array;

    // openWakeWord applies this transform between melspectrogram and
    // embedding; the embedding model was trained on the scaled values.
    const scaled = new Float32Array(mel.length);
    for (let i = 0; i < mel.length; i++) scaled[i] = mel[i] / 10 + 2;

    const embOut = await this.embModel.run({
      input_1: new Tensor("float32", scaled, [1, MEL_FRAMES, MEL_BINS, 1]),
    });
    const embedding = Object.values(embOut)[0].data as Float32Array;

    this.embeddings.push(new Float32Array(embedding));
    if (this.embeddings.length > EMBEDDING_WINDOW) this.embeddings.shift();
    if (this.embeddings.length < EMBEDDING_WINDOW) return 0;

    const stacked = new Float32Array(EMBEDDING_WINDOW * EMBEDDING_DIM);
    this.embeddings.forEach((e, i) => stacked.set(e, i * EMBEDDING_DIM));

    const scoreOut = await this.wakeModel.run({
      "x.1": new Tensor("float32", stacked, [1, EMBEDDING_WINDOW, EMBEDDING_DIM]),
    });
    return (Object.values(scoreOut)[0].data as Float32Array)[0];
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
    this.melModel = null;
    this.embModel = null;
    this.wakeModel = null;
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
