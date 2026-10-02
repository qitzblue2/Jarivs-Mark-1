import { loadRuntime, modelPath } from "./onnx";

/**
 * Silero VAD on the device.
 *
 * The browser path uses @ricky0123/vad-web, which owns its own microphone
 * and AudioWorklet — neither of which exists in Node. Here the same model
 * file is driven directly: 512-sample windows in, a speech probability out,
 * with the recurrent state carried between calls.
 *
 * The state is the whole reason this can't be stateless. Silero is an RNN;
 * feeding it windows out of order, or resetting between them, produces
 * confident nonsense.
 */

/** Silero v5 wants exactly 512 samples at 16 kHz. */
export const VAD_WINDOW = 512;
export const VAD_SAMPLE_RATE = 16000;
const STATE_SIZE = 2 * 1 * 128;

type Session = Awaited<ReturnType<typeof import("onnxruntime-node").InferenceSession.create>>;

export class DeviceVad {
  private session: Session | null = null;
  private loading: Promise<void> | null = null;
  private state = new Float32Array(STATE_SIZE);
  /** Samples left over from the last frame; windows must not be ragged. */
  private leftover = new Float32Array(0);
  private tensor: typeof import("onnxruntime-node").Tensor | null = null;

  async load(): Promise<void> {
    if (this.session) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const runtime = await loadRuntime();
      this.tensor = runtime.Tensor;
      this.session = await runtime.InferenceSession.create(
        modelPath("vad", "silero_vad_v5.onnx"),
        { graphOptimizationLevel: "all", intraOpNumThreads: 1, interOpNumThreads: 1 },
      );
    })();

    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  get isLoaded(): boolean {
    return this.session !== null;
  }

  /** Speech probability for one 512-sample window. */
  private async score(window: Float32Array): Promise<number> {
    const session = this.session;
    const Tensor = this.tensor;
    if (!session || !Tensor) return 0;

    const output = await session.run({
      input: new Tensor("float32", window, [1, VAD_WINDOW]),
      state: new Tensor("float32", this.state, [2, 1, 128]),
      sr: new Tensor("int64", BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []),
    });

    this.state = Float32Array.from(output.stateN.data as Float32Array);
    return (output.output.data as Float32Array)[0];
  }

  /**
   * Score an arbitrary-length frame, window by window.
   *
   * Capture hands over 1280 samples at a time and Silero wants 512, which
   * don't divide — hence the leftover buffer. Returns one entry per whole
   * window, each paired with the audio it scored so the caller can keep it.
   */
  async process(frame: Float32Array): Promise<{ probability: number; window: Float32Array }[]> {
    let buffer: Float32Array;
    if (this.leftover.length > 0) {
      buffer = new Float32Array(this.leftover.length + frame.length);
      buffer.set(this.leftover, 0);
      buffer.set(frame, this.leftover.length);
    } else {
      buffer = frame;
    }

    const results: { probability: number; window: Float32Array }[] = [];
    let offset = 0;
    while (buffer.length - offset >= VAD_WINDOW) {
      const window = buffer.slice(offset, offset + VAD_WINDOW);
      offset += VAD_WINDOW;
      results.push({ probability: await this.score(window), window });
    }

    this.leftover = buffer.slice(offset);
    return results;
  }

  reset(): void {
    this.state = new Float32Array(STATE_SIZE);
    this.leftover = new Float32Array(0);
  }

  dispose(): void {
    this.reset();
    this.session = null;
  }
}
