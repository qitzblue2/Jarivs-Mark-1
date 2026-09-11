/** Pluggable wake-word detection, so Porcupine could replace openWakeWord. */
export interface WakeWordDetector {
  /** Load models. Safe to call twice. */
  load(): Promise<void>;
  /** Feed one 1280-sample 16 kHz frame; returns the current 0-1 score. */
  push(frame: Float32Array): Promise<number>;
  reset(): void;
  dispose(): void;
}

/**
 * Turns a stream of scores into discrete fires.
 *
 * Kept as a pure class so wake-word behaviour is unit-testable without audio
 * hardware or ONNX: the tricky part isn't the model, it's not firing five
 * times for one "hey jarvis".
 */
export class WakeGate {
  private above = 0;
  private cooldownUntil = 0;

  constructor(
    private threshold = 0.5,
    /** Consecutive frames over threshold before firing. Rejects blips. */
    private patience = 2,
    /** Frames to ignore after a fire (~80ms each). 25 ≈ 2 seconds. */
    private cooldownFrames = 25,
  ) {}

  /** Returns true exactly once per detected utterance. */
  accept(score: number, frameIndex: number): boolean {
    if (frameIndex < this.cooldownUntil) return false;

    if (score < this.threshold) {
      this.above = 0;
      return false;
    }

    this.above++;
    if (this.above < this.patience) return false;

    this.above = 0;
    this.cooldownUntil = frameIndex + this.cooldownFrames;
    return true;
  }

  reset(): void {
    this.above = 0;
    this.cooldownUntil = 0;
  }
}

/**
 * Decides when the speaker has finished talking.
 *
 * Also pure, for the same reason: "did they stop?" is all timing logic and
 * needs testing at the edges (never spoke at all, paused mid-sentence).
 */
export class SilenceGate {
  private spoke = false;
  private quietFrames = 0;
  private totalFrames = 0;

  constructor(
    private speakingRms = 0.015,
    /** Quiet frames before we call it done. 15 ≈ 1.2s at 80ms. */
    private hangoverFrames = 15,
    /** Hard stop so a noisy room can't record forever. */
    private maxFrames = 190,
    /** Give up if they never start. */
    private noSpeechFrames = 90,
  ) {}

  push(rms: number): "listening" | "done" | "timeout" {
    this.totalFrames++;

    if (rms >= this.speakingRms) {
      this.spoke = true;
      this.quietFrames = 0;
    } else if (this.spoke) {
      this.quietFrames++;
    }

    if (this.spoke && this.quietFrames >= this.hangoverFrames) return "done";
    if (this.totalFrames >= this.maxFrames) return this.spoke ? "done" : "timeout";
    if (!this.spoke && this.totalFrames >= this.noSpeechFrames) return "timeout";
    return "listening";
  }

  reset(): void {
    this.spoke = false;
    this.quietFrames = 0;
    this.totalFrames = 0;
  }
}
