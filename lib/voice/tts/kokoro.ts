import type { SpeakOptions, TtsEngine } from "./types";

/**
 * Kokoro — an 82M-parameter Apache-2.0 speech model that runs entirely in the
 * browser, on WebGPU where available and WASM otherwise.
 *
 * Chosen on the same test as the wake word: open weights, no account, no key,
 * nothing that phones home, and it keeps working offline once the model is
 * cached. Nobody can revoke it or start charging for it.
 *
 * The weights are a one-time ~86MB download (q8), cached by the browser
 * afterwards. That is the honest cost of not sounding like a satnav.
 */

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** A usable spread rather than the full catalogue, which is overwhelming. */
const VOICES: { id: string; label: string }[] = [
  { id: "af_heart", label: "Heart — American, warm" },
  { id: "af_bella", label: "Bella — American, bright" },
  { id: "af_nicole", label: "Nicole — American, soft" },
  { id: "af_sarah", label: "Sarah — American, even" },
  { id: "am_michael", label: "Michael — American, steady" },
  { id: "am_fenrir", label: "Fenrir — American, deep" },
  { id: "am_puck", label: "Puck — American, lively" },
  { id: "bf_emma", label: "Emma — British, measured" },
  { id: "bf_isabella", label: "Isabella — British, clear" },
  { id: "bm_george", label: "George — British, dry" },
  { id: "bm_daniel", label: "Daniel — British, calm" },
];

const DEFAULT_VOICE = "bm_george";

type KokoroModule = typeof import("kokoro-js");
type KokoroInstance = Awaited<ReturnType<KokoroModule["KokoroTTS"]["from_pretrained"]>>;

export class KokoroTts implements TtsEngine {
  id = "kokoro";
  label = "Kokoro (natural, local)";

  private model: KokoroInstance | null = null;
  private loading: Promise<KokoroInstance> | null = null;
  private audio: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  /** Reported during the first-run download so the UI can show progress. */
  onProgress?: (percent: number) => void;

  isAvailable(): boolean {
    return typeof window !== "undefined";
  }

  async voices(): Promise<{ id: string; label: string }[]> {
    return VOICES;
  }

  /** True once the model is in memory and speech is instant. */
  get isLoaded(): boolean {
    return this.model !== null;
  }

  /**
   * Load on first use.
   *
   * Never imported at module scope: kokoro-js pulls in transformers.js, which
   * resolves asset paths on evaluation and throws under server rendering —
   * the same trap the wake-word runtime set in Mark 3.
   */
  private async load(): Promise<KokoroInstance> {
    if (this.model) return this.model;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const { KokoroTTS } = await import("kokoro-js");

      // WebGPU is several times faster; WASM is the universal fallback.
      const webgpu =
        typeof navigator !== "undefined" &&
        "gpu" in navigator &&
        (await (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
          ?.requestAdapter()
          .then((a) => Boolean(a))
          .catch(() => false));

      const model = await KokoroTTS.from_pretrained(MODEL_ID, {
        // q8 is the sweet spot: ~86MB against fp32's ~326MB, with no
        // audible loss for speech at this size.
        dtype: webgpu ? "fp32" : "q8",
        device: webgpu ? "webgpu" : "wasm",
        progress_callback: (info) => {
          // The union covers initiate/download/progress/done; only the
          // progress variant carries a percentage.
          const percent = (info as { progress?: number }).progress;
          if (typeof percent === "number") this.onProgress?.(percent);
        },
      });

      this.model = model;
      return model;
    })();

    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    if (!text.trim()) return;

    const model = await this.load();
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    const raw = await model.generate(text, {
      voice: (options.voice || DEFAULT_VOICE) as never,
      speed: options.rate ?? 1,
    });

    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    await this.play(raw.audio as Float32Array, raw.sampling_rate as number, options.signal);
  }

  /**
   * Play raw samples through Web Audio.
   *
   * Direct playback rather than encoding a WAV and handing it to an <audio>
   * element: it avoids a blob round-trip per sentence, which matters when a
   * long reply is spoken as dozens of chunks back to back.
   */
  private play(samples: Float32Array, sampleRate: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.context || this.context.state === "closed") {
        this.context = new AudioContext();
      }
      const context = this.context;
      void context.resume().catch(() => {});

      const buffer = context.createBuffer(1, samples.length, sampleRate);
      // copyToChannel wants a Float32Array over a plain ArrayBuffer; the model
      // may hand back one backed by a SharedArrayBuffer under WebGPU.
      buffer.copyToChannel(new Float32Array(samples), 0);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      this.source = source;

      const onAbort = () => {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
        reject(new DOMException("Cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      source.onended = () => {
        signal?.removeEventListener("abort", onAbort);
        if (this.source === source) this.source = null;
        resolve();
      };

      source.start();
    });
  }

  cancel(): void {
    try {
      this.source?.stop();
    } catch {
      /* already stopped */
    }
    this.source = null;
    this.audio?.pause();
    this.audio = null;
  }
}
