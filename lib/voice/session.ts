import { OpenWakeWord } from "./wake/openwakeword";
import { SilenceGate, WakeGate } from "./wake/types";
import { transcribe } from "./stt";
import { forSpeech, getTts } from "./tts";
import { Speaker } from "./tts/speaker";
import { SileroVad } from "./vad";

export type VoiceState =
  | "off"
  | "loading"
  | "idle"        // listening for the wake word
  | "greeting"    // speaking the greeting
  | "listening"   // capturing the user's question
  | "transcribing"
  | "thinking"    // model is answering
  | "speaking"
  | "error";

export const DEFAULT_GREETING = "Hey sir, how can I help you today?";

/** Phrases that end a continuous conversation. */
const STOP_WORDS = /^\s*(stop|goodbye|good bye|bye|that's all|thats all|exit|nevermind|never mind)\b/i;

/** Live numbers so "it can't hear me" is answerable at a glance. */
export interface VoiceDiagnostics {
  /** Frames delivered by the audio thread. Zero means the mic isn't running. */
  frames: number;
  /** Frames actually scored. Far below `frames` means inference can't keep up. */
  scored: number;
  /** Loudest input seen, for comparison against the speaking threshold. */
  peakLevel: number;
  /** Best wake-word score seen, for choosing a threshold that works. */
  peakScore: number;
  /** Measured room noise, used as the speaking threshold's floor. */
  noiseFloor: number;
  /** Live speech probability from Silero, 0-1. */
  speechProbability: number;
  /** Time from question sent to the first audio, in ms. */
  firstAudioMs: number;
  /** Most recent per-sentence synthesis time, in ms. */
  synthesisMs: number;
}

export interface VoiceCallbacks {
  onState(state: VoiceState, detail?: string): void;
  onLevel(rms: number): void;
  onScore(score: number): void;
  onDiagnostics(diagnostics: VoiceDiagnostics): void;
  onTranscript(text: string): void;
  /**
   * Send to the model. `onToken` is called as the reply streams, so speech
   * can start before generation finishes; the promise resolves with the
   * full reply.
   */
  onQuestion(text: string, onToken: (chunk: string) => void): Promise<string>;
  onError(message: string): void;
}

export interface VoiceConfig {
  greeting: string;
  ttsEngine: string;
  ttsVoice?: string;
  /** Speaking rate, from Settings. */
  ttsSpeed?: number;
  /** Keep listening after each answer instead of returning to idle. */
  continuous: boolean;
  /** Skip the wake word; go straight to listening (the mic button). */
  pushToTalk?: boolean;
  /** Speech-probability threshold for turn taking. */
  vadThreshold?: number;
  threshold: number;
  apiKey?: string;
}

/**
 * Drives the whole voice loop:
 *
 *   idle --wake word--> greeting --> listening --> transcribe
 *        --> model --> speak --> (continuous ? listening : idle)
 *
 * Audio capture and wake-word scoring stay local; only the recorded question
 * is sent anywhere.
 */
export class VoiceSession {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  private detector = new OpenWakeWord();
  private vad = new SileroVad();
  /** False if the VAD model can't load; the loudness gate then takes over. */
  private useVad = true;
  private wakeGate: WakeGate;
  private silenceGate = new SilenceGate();

  private state: VoiceState = "off";
  private frameIndex = 0;
  private diagnostics: VoiceDiagnostics = {
    frames: 0, scored: 0, peakLevel: 0, peakScore: 0, noiseFloor: 0, speechProbability: 0, firstAudioMs: 0, synthesisMs: 0,
  };
  /** Rolling RMS history (~4s) used to track the room's noise floor. */
  private recentRms: number[] = [];
  /** When the current question was sent, for the latency readout. */
  private turnStartedAt = 0;
  private recording: Float32Array[] = [];
  private speakAbort: AbortController | null = null;
  private speaker: Speaker | null = null;
  /** Guards against overlapping async work when frames keep arriving. */
  private busy = false;

  constructor(
    private config: VoiceConfig,
    private callbacks: VoiceCallbacks,
  ) {
    this.wakeGate = new WakeGate(config.threshold);
  }

  updateConfig(config: Partial<VoiceConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.threshold !== undefined) this.wakeGate = new WakeGate(config.threshold);
  }

  private setState(state: VoiceState, detail?: string): void {
    this.state = state;
    this.callbacks.onState(state, detail);
  }

  /** Returns a human-readable reason the mic can't be used, or null. */
  private preflight(): string | null {
    if (typeof window === "undefined") return "Voice only runs in a browser.";

    // An insecure origin removes mediaDevices entirely, which otherwise
    // surfaces as "Cannot read properties of undefined".
    if (!window.isSecureContext) {
      return (
        `This page is not a secure context (${window.location.origin}), so the ` +
        "browser blocks microphone access. Open it on http://localhost:3000, " +
        "or serve it over HTTPS with `npm run dev:https`."
      );
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return "This browser doesn't expose microphone access on this page.";
    }
    return null;
  }

  async start(): Promise<void> {
    if (this.context) return;
    this.setState("loading");

    const blocked = this.preflight();
    if (blocked) {
      this.callbacks.onError(blocked);
      this.setState("error", blocked);
      return;
    }

    try {
      // Created before the await so it inherits the click that opened voice
      // mode; resumed explicitly below in case the browser still suspends it.
      this.context = new AudioContext();

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      await this.context.audioWorklet.addModule("/worklets/pcm-worklet.js");

      // A suspended context never runs the worklet, so no audio would ever
      // arrive and the session would sit in `idle` looking fine.
      if (this.context.state === "suspended") await this.context.resume();
      if (this.context.state !== "running") {
        throw new Error(
          "The browser is holding audio suspended. Click the page, then try again.",
        );
      }

      // Wake-word models only matter when we're actually waiting for one.
      if (!this.config.pushToTalk) await this.detector.load();

      const source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, "pcm-worklet");
      this.node.port.onmessage = (event) => {
        if (event.data?.type === "frame") {
          void this.onFrame(event.data.samples as Float32Array, event.data.rms as number);
        }
      };
      source.connect(this.node);
      // Terminate the graph without routing mic audio to the speakers.
      this.node.connect(this.context.destination);

      // Neural turn-taking, with the loudness gate as the fallback if the
      // model is unavailable.
      try {
        await this.vad.start(
          {
            onSpeechStart: () => this.onSpeechStart(),
            onSpeechEnd: (audio) => void this.onSpeechEnd(audio),
            onFrame: (probability) => {
              this.diagnostics.speechProbability = probability;
            },
            onError: () => {},
          },
          { threshold: this.config.vadThreshold ?? 0.5 },
        );
      } catch {
        this.useVad = false;
        this.callbacks.onError(
          "Neural speech detection unavailable — falling back to volume-based turn taking.",
        );
      }

      if (this.config.pushToTalk) this.beginListening();
      else this.setState("idle");
    } catch (err) {
      const error = err as Error;
      const message =
        error?.name === "NotAllowedError"
          ? "Microphone permission denied. Click the padlock in the address bar and allow the mic, then reopen voice mode."
          : error?.name === "NotFoundError"
            ? "No microphone found. Plug one in or pick one in your system sound settings."
            : error?.name === "NotReadableError"
              ? "Your microphone is in use by another app. Close it and try again."
              : `Could not start voice: ${error.message}`;
      this.callbacks.onError(message);
      this.setState("error", message);
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.speaker?.cancel();
    this.speaker = null;
    this.speakAbort?.abort();
    this.speakAbort = null;
    getTts(this.config.ttsEngine).cancel();

    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    await this.context?.close().catch(() => {});
    this.context = null;

    this.vad.destroy();
    this.detector.dispose();
    this.recording = [];
    this.busy = false;
    this.setState("off");
  }

  /** Barge-in: stop talking and listen again. */
  interrupt(): void {
    this.speaker?.cancel();
    this.speakAbort?.abort();
    getTts(this.config.ttsEngine).cancel();
  }

  /**
   * Track the room's noise floor from a rolling window.
   *
   * Must be the QUIETEST recent audio, not an average of the first frames:
   * sampling the opening second assumes the user waits in silence, and if
   * they start talking straight away the "floor" becomes their voice and the
   * threshold lands above anything reachable — at which point nothing is ever
   * heard again. The result is clamped so a pathological measurement can't
   * disable speech detection either way.
   */
  private trackNoiseFloor(rms: number): void {
    this.recentRms.push(rms);
    if (this.recentRms.length > 50) this.recentRms.shift();
    if (this.recentRms.length < 12) return;

    const sorted = [...this.recentRms].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.2)];
    this.diagnostics.noiseFloor = floor;

    // Comfortably above the noise, but always within a range that can
    // actually be crossed by a normal speaking voice.
    this.silenceGate.speakingRms = Math.min(0.05, Math.max(0.006, floor * 3));
  }

  /**
   * Real speech began.
   *
   * Doubles as barge-in: hearing actual speech while JARVIS talks stops it,
   * where the old volume check would also trigger on a door slam.
   */
  private onSpeechStart(): void {
    if (this.state === "speaking" || this.state === "greeting") this.interrupt();
  }

  /** Silero says the speaker has stopped; transcribe what it captured. */
  private async onSpeechEnd(audio: Float32Array): Promise<void> {
    if (!this.useVad) return;
    if (this.state !== "listening") return;

    // Silero hands back the whole utterance with pre-speech padding, so its
    // capture is used directly rather than our own frame buffer.
    this.recording = [audio];
    await this.onUtteranceComplete();
  }

  private emitDiagnostics(): void {
    this.callbacks.onDiagnostics({ ...this.diagnostics });
  }

  /** Current diagnostics, for the calibration flow to read back. */
  snapshot(): VoiceDiagnostics {
    return { ...this.diagnostics };
  }

  /** Reset peak counters, for the calibration flow. */
  resetDiagnostics(): void {
    this.diagnostics = {
      ...this.diagnostics, frames: 0, scored: 0, peakLevel: 0, peakScore: 0,
    };
    this.emitDiagnostics();
  }

  private beginListening(): void {
    this.recording = [];
    this.silenceGate.reset();
    this.setState("listening");
  }

  private async onFrame(samples: Float32Array, rms: number): Promise<void> {
    this.frameIndex++;
    this.callbacks.onLevel(rms);

    this.diagnostics.frames++;
    if (rms > this.diagnostics.peakLevel) this.diagnostics.peakLevel = rms;

    this.trackNoiseFloor(rms);

    if (this.state === "idle") {
      // Buffering is cheap and must happen for EVERY frame: skipping it
      // would leave gaps in the window and the wake word would never match.
      this.detector.append(samples);

      // Scoring is what may fall behind, and skipping it is harmless.
      if (this.busy) {
        this.emitDiagnostics();
        return;
      }
      this.busy = true;
      try {
        const score = await this.detector.score();
        this.diagnostics.scored++;
        if (score > this.diagnostics.peakScore) this.diagnostics.peakScore = score;
        this.callbacks.onScore(score);
        this.emitDiagnostics();
        if (this.wakeGate.accept(score, this.frameIndex)) await this.onWake();
      } catch {
        // One failed inference is not worth surfacing; the next frame scores.
      } finally {
        this.busy = false;
      }
      return;
    }

    this.emitDiagnostics();

    if (this.state === "listening") {
      // With Silero driving, end-of-turn comes from onSpeechEnd; the volume
      // gate would otherwise cut in early and fight it.
      if (this.useVad) return;

      this.recording.push(samples);
      const verdict = this.silenceGate.push(rms);
      if (verdict === "done") await this.onUtteranceComplete();
      else if (verdict === "timeout") this.afterTurn("I didn't catch anything.");
      return;
    }

    // While greeting/thinking/speaking, a loud frame means the user is
    // talking over JARVIS — stop and listen.
    if (!this.useVad && (this.state === "speaking" || this.state === "greeting") && rms > 0.06) {
      this.interrupt();
    }
  }

  private async onWake(): Promise<void> {
    this.detector.reset();
    this.setState("greeting");
    await this.say(this.config.greeting);
    if (this.state === "greeting") this.beginListening();
  }

  private async onUtteranceComplete(): Promise<void> {
    const frames = this.recording;
    this.recording = [];
    this.setState("transcribing");

    try {
      const text = await transcribe(frames, { key: this.config.apiKey });

      if (!text) return this.afterTurn();
      this.callbacks.onTranscript(text);

      if (STOP_WORDS.test(text)) {
        await this.say("Goodbye, sir.");
        this.returnToIdle();
        return;
      }

      this.setState("thinking");
      this.turnStartedAt = Date.now();

      // Speech starts on the first complete sentence rather than after the
      // whole reply, which is both why it feels responsive and why long
      // answers no longer get swallowed by a single oversized utterance.
      const speaker = this.freshSpeaker();
      let pushed = 0;
      let switchedToSpeaking = false;

      /**
       * Clean the CUMULATIVE text and push only the new tail.
       *
       * Cleaning each delta separately does not work: forSpeech trims, so the
       * space between two streamed tokens is deleted and words run together
       * ("sentence " + "number" became "sentencenumber").
       */
      const feed = (soFar: string) => {
        const cleaned = forSpeech(soFar);
        const fresh = cleaned.slice(pushed);
        if (!fresh) return;
        pushed = cleaned.length;

        if (!switchedToSpeaking) {
          switchedToSpeaking = true;
          this.setState("speaking");
        }
        speaker.push(fresh);
      };

      const reply = await this.callbacks.onQuestion(text, feed);

      // Covers a non-streaming caller, and any tail the last event missed.
      feed(reply);
      speaker.end();

      this.setState("speaking");
      await speaker.wait();
      this.afterTurn();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return this.afterTurn();
      const message = (err as Error).message;
      this.callbacks.onError(message);
      this.afterTurn();
    }
  }

  /** Continuous mode loops straight back to listening. */
  private afterTurn(note?: string): void {
    if (note) this.callbacks.onError(note);
    if (this.config.continuous && this.config.pushToTalk !== true) this.beginListening();
    else this.returnToIdle();
  }

  private returnToIdle(): void {
    this.detector.reset();
    this.wakeGate.reset();
    if (this.config.pushToTalk) void this.stop();
    else this.setState("idle");
  }

  /** Speak a complete phrase and wait for it. */
  private async say(text: string): Promise<void> {
    if (!text) return;
    const speaker = this.freshSpeaker();
    speaker.say(text);
    await speaker.wait();
  }

  /**
   * A Speaker for one turn.
   *
   * Rebuilt each time so a cancelled turn can't leave the queue poisoned, and
   * so an engine changed in Settings mid-session takes effect immediately.
   */
  private freshSpeaker(): Speaker {
    this.speaker?.cancel();
    this.speaker = new Speaker(
      getTts(this.config.ttsEngine),
      { voice: this.config.ttsVoice, rate: this.config.ttsSpeed },
      (message) => this.callbacks.onError(`Speech failed: ${message}`),
      ({ synthesisMs, firstAudio }) => {
        // Makes "it feels slow" a number rather than an argument.
        this.diagnostics.synthesisMs = synthesisMs;
        if (firstAudio && this.turnStartedAt) {
          this.diagnostics.firstAudioMs = Date.now() - this.turnStartedAt;
        }
        this.emitDiagnostics();
      },
    );
    return this.speaker;
  }
}
