/**
 * Neural turn-taking.
 *
 * The previous end-of-turn detector was a loudness threshold: anything above
 * it counted as speech. That can't tell a voice from a fan, so a noisy room
 * kept it listening forever and a mid-sentence pause read as "done". Silero
 * VAD gives an actual speech probability per frame, which is the difference
 * between guessing and knowing.
 *
 * MIT licensed, ~2MB, runs locally — the same terms as everything else in the
 * voice stack.
 */

export interface VadOptions {
  /** Speech probability above which a frame counts as speech. */
  threshold?: number;
  /** Quiet time before the turn is considered over. */
  redemptionMs?: number;
  /** Ignore speech blips shorter than this. */
  minSpeechMs?: number;
}

export interface VadCallbacks {
  onSpeechStart(): void;
  /** Fires with the captured audio once the speaker stops. */
  onSpeechEnd(audio: Float32Array): void;
  onFrame(probability: number): void;
  onError(message: string): void;
}

type MicVad = { start(): void; pause(): void; destroy(): void };

export class SileroVad {
  private vad: MicVad | null = null;
  private starting: Promise<void> | null = null;

  get isRunning(): boolean {
    return this.vad !== null;
  }

  /**
   * Start listening.
   *
   * The library manages its own microphone stream and AudioWorklet. Assets
   * are served from /vad rather than a CDN, so this keeps working offline and
   * doesn't depend on anyone else staying up.
   */
  async start(callbacks: VadCallbacks, options: VadOptions = {}): Promise<void> {
    if (this.vad) return;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      // Lazy: the package resolves worklet and wasm paths on import, which
      // breaks server rendering exactly as the other ONNX runtimes do.
      const { MicVAD } = await import("@ricky0123/vad-web");

      const vad = await MicVAD.new({
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
        positiveSpeechThreshold: options.threshold ?? 0.5,
        negativeSpeechThreshold: (options.threshold ?? 0.5) - 0.15,
        // 700ms of quiet before the turn is over: long enough to pause and
        // think mid-sentence, short enough that replies don't feel delayed.
        redemptionMs: options.redemptionMs ?? 700,
        // Ignore a cough or a chair creak.
        minSpeechMs: options.minSpeechMs ?? 120,
        // Keep the moment before speech was detected, or the first syllable
        // gets clipped off the transcription.
        preSpeechPadMs: 250,
        onSpeechStart: () => callbacks.onSpeechStart(),
        onSpeechEnd: (audio: Float32Array) => callbacks.onSpeechEnd(audio),
        onFrameProcessed: (probs: { isSpeech: number }) => callbacks.onFrame(probs.isSpeech),
      });

      vad.start();
      this.vad = vad as MicVad;
    })();

    try {
      await this.starting;
    } catch (err) {
      callbacks.onError((err as Error).message);
      throw err;
    } finally {
      this.starting = null;
    }
  }

  pause(): void {
    this.vad?.pause();
  }

  resume(): void {
    this.vad?.start();
  }

  destroy(): void {
    try {
      this.vad?.destroy();
    } catch {
      /* already gone */
    }
    this.vad = null;
  }
}

/** Silero runs at 16kHz, same as the wake word — no resampling needed. */
export const VAD_SAMPLE_RATE = 16000;
