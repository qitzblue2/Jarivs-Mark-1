import { SentenceSplitter } from "./sentences";
import type { PreparedSpeech, SpeakOptions, TtsEngine } from "./types";

/**
 * Speaks a reply as it is generated.
 *
 * Text arrives token by token; complete sentences are queued and spoken while
 * the model is still writing the rest. That removes the dead air before JARVIS
 * starts talking, and — more importantly — means no single utterance is ever
 * long enough to hit the engine limits that were silently swallowing long
 * replies whole.
 *
 * Engine-agnostic: it drives whatever TtsEngine it is handed, so the browser
 * voice, Kokoro and Groq all benefit.
 */
export class Speaker {
  private splitter = new SentenceSplitter();
  private queue: string[] = [];
  /** Syntheses already in flight, in playback order. */
  private prepared: { promise: Promise<PreparedSpeech>; abort: AbortController }[] = [];
  private draining = false;
  private cancelled = false;
  /** Set by end(): no more text is coming. */
  private ended = false;
  private spokeAnything = false;
  private controller: AbortController | null = null;
  /** Resolves when everything queued has finished playing. */
  private idle: Promise<void> = Promise.resolve();
  private markIdle: (() => void) | null = null;

  /**
   * How many sentences to generate ahead of the one playing.
   *
   * Two is enough to cover a synthesis that takes as long as a sentence takes
   * to speak, without generating far into a reply the user may interrupt.
   */
  private static readonly LOOKAHEAD = 2;

  constructor(
    private engine: TtsEngine,
    private options: SpeakOptions = {},
    /** Called if the engine fails, so the caller can fall back or warn. */
    private onError?: (message: string) => void,
    /** Reports synthesis time per chunk, for the latency readout. */
    private onTiming?: (event: { synthesisMs: number; firstAudio: boolean }) => void,
  ) {}

  /** Swap the engine mid-session (Settings change, or a fallback). */
  useEngine(engine: TtsEngine, options: SpeakOptions = {}): void {
    this.engine = engine;
    this.options = options;
  }

  /** Feed generated text. Speech starts as soon as a sentence completes. */
  push(text: string): void {
    if (this.cancelled) return;
    // More is coming, so a wait() in flight must not complete yet.
    this.ended = false;
    for (const chunk of this.splitter.push(text)) this.enqueue(chunk);
  }

  /**
   * Speak a complete string immediately (the greeting, error lines).
   *
   * Implies end(): the text is whole, so wait() must be able to complete.
   * Without this, a caller that only ever calls say() waits forever.
   */
  say(text: string): void {
    if (this.cancelled) return;
    for (const chunk of this.splitter.push(text)) this.enqueue(chunk);
    for (const chunk of this.splitter.flush()) this.enqueue(chunk);
    this.ended = true;
  }

  /** No more text is coming; release the final partial sentence. */
  end(): void {
    if (this.cancelled) return;
    this.ended = true;
    for (const chunk of this.splitter.flush()) this.enqueue(chunk);
  }

  private enqueue(chunk: string): void {
    if (!chunk.trim()) return;
    this.queue.push(chunk);

    if (!this.markIdle) {
      this.idle = new Promise<void>((resolve) => {
        this.markIdle = resolve;
      });
    }

    void this.drain();
  }

  /**
   * Start generating a chunk without playing it.
   *
   * Engines that can't split generation from playback resolve immediately
   * with a prepared object that does both on play — identical to the old
   * sequential behaviour, which is what speechSynthesis needs.
   */
  private prepare(chunk: string): { promise: Promise<PreparedSpeech>; abort: AbortController } {
    const abort = new AbortController();
    const engine = this.engine;
    const started = Date.now();
    const wasFirst = !this.spokeAnything;

    if (!engine.synthesize) {
      return {
        abort,
        promise: Promise.resolve({
          play: (signal) => engine.speak(chunk, { ...this.options, signal }),
        }),
      };
    }

    const promise = engine
      .synthesize(chunk, { ...this.options, signal: abort.signal })
      .then((speech) => {
        this.onTiming?.({ synthesisMs: Date.now() - started, firstAudio: wasFirst });
        return speech;
      });

    return { abort, promise };
  }

  /** Keep the pipeline full so the next sentence is ready when this one ends. */
  private fillPrefetch(): void {
    while (
      !this.cancelled &&
      this.queue.length > 0 &&
      this.prepared.length < Speaker.LOOKAHEAD
    ) {
      this.prepared.push(this.prepare(this.queue.shift()!));
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      for (;;) {
        this.fillPrefetch();
        if (this.prepared.length === 0 || this.cancelled) break;

        const next = this.prepared.shift()!;
        // Top the pipeline back up BEFORE awaiting, so the following
        // sentence generates while this one plays.
        this.fillPrefetch();

        try {
          const speech = await next.promise;
          if (this.cancelled) {
            speech.dispose?.();
            break;
          }

          this.controller = new AbortController();
          this.spokeAnything = true;
          await speech.play(this.controller.signal);
          speech.dispose?.();
        } catch (err) {
          if ((err as Error)?.name === "AbortError") break;
          // One bad chunk must not silence the rest of the answer.
          this.onError?.((err as Error).message);
        } finally {
          this.controller = null;
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length === 0 && this.prepared.length === 0) {
        this.markIdle?.();
        this.markIdle = null;
      }
    }
  }

  /**
   * Wait until everything has been spoken.
   *
   * Must not return merely because the queue is momentarily empty: while the
   * model is still streaming, the queue empties between sentences, and an
   * early return let the caller tear the session down mid-answer — speech
   * stopped after a few sentences. Completion requires end() as well.
   */
  async wait(timeoutMs = 10 * 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (
      !this.cancelled &&
      (!this.ended || this.queue.length > 0 || this.prepared.length > 0 || this.draining)
    ) {
      // Never hang the session outright if end() is somehow never reached.
      if (Date.now() > deadline) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Stop immediately — barge-in, or the user leaving voice mode. */
  cancel(): void {
    this.cancelled = true;
    this.queue = [];
    this.splitter.reset();
    // Abort work already in flight, or barge-in would wait for a synthesis
    // whose audio is going to be thrown away.
    for (const entry of this.prepared) {
      entry.abort.abort();
      void entry.promise.then((s) => s.dispose?.()).catch(() => {});
    }
    this.prepared = [];
    this.controller?.abort();
    this.engine.cancel();
    this.markIdle?.();
    this.markIdle = null;
  }

  /** Ready for another turn after a cancel. */
  reset(): void {
    this.cancelled = false;
    this.ended = false;
    this.spokeAnything = false;
    this.queue = [];
    this.prepared = [];
    this.splitter.reset();
  }

  get isSpeaking(): boolean {
    return this.draining || this.queue.length > 0 || this.prepared.length > 0;
  }
}
