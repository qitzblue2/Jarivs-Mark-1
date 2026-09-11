import { OpenWakeWord } from "./wake/openwakeword";
import { SilenceGate, WakeGate } from "./wake/types";
import { transcribe } from "./stt";
import { forSpeech, getTts } from "./tts";

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

export interface VoiceCallbacks {
  onState(state: VoiceState, detail?: string): void;
  onLevel(rms: number): void;
  onScore(score: number): void;
  onTranscript(text: string): void;
  /** Send to the model; resolves with the spoken-form reply. */
  onQuestion(text: string): Promise<string>;
  onError(message: string): void;
}

export interface VoiceConfig {
  greeting: string;
  ttsEngine: string;
  ttsVoice?: string;
  /** Keep listening after each answer instead of returning to idle. */
  continuous: boolean;
  /** Skip the wake word; go straight to listening (the mic button). */
  pushToTalk?: boolean;
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
  private wakeGate: WakeGate;
  private silenceGate = new SilenceGate();

  private state: VoiceState = "off";
  private frameIndex = 0;
  private recording: Float32Array[] = [];
  private speakAbort: AbortController | null = null;
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

  async start(): Promise<void> {
    if (this.context) return;
    this.setState("loading");

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.context = new AudioContext();
      await this.context.audioWorklet.addModule("/worklets/pcm-worklet.js");

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

      if (this.config.pushToTalk) this.beginListening();
      else this.setState("idle");
    } catch (err) {
      const message =
        (err as Error)?.name === "NotAllowedError"
          ? "Microphone permission denied. Allow mic access to use voice."
          : `Could not start voice: ${(err as Error).message}`;
      this.callbacks.onError(message);
      this.setState("error", message);
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
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

    this.detector.dispose();
    this.recording = [];
    this.busy = false;
    this.setState("off");
  }

  /** Barge-in: stop talking and listen again. */
  interrupt(): void {
    this.speakAbort?.abort();
    getTts(this.config.ttsEngine).cancel();
  }

  private beginListening(): void {
    this.recording = [];
    this.silenceGate.reset();
    this.setState("listening");
  }

  private async onFrame(samples: Float32Array, rms: number): Promise<void> {
    this.frameIndex++;
    this.callbacks.onLevel(rms);

    if (this.state === "idle") {
      if (this.busy) return;
      this.busy = true;
      try {
        const score = await this.detector.push(samples);
        this.callbacks.onScore(score);
        if (this.wakeGate.accept(score, this.frameIndex)) await this.onWake();
      } catch {
        // A dropped frame is not worth surfacing; the next one will score.
      } finally {
        this.busy = false;
      }
      return;
    }

    if (this.state === "listening") {
      this.recording.push(samples);
      const verdict = this.silenceGate.push(rms);
      if (verdict === "done") await this.onUtteranceComplete();
      else if (verdict === "timeout") this.afterTurn("I didn't catch anything.");
      return;
    }

    // While greeting/thinking/speaking, a loud frame means the user is
    // talking over JARVIS — stop and listen.
    if ((this.state === "speaking" || this.state === "greeting") && rms > 0.06) {
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
      const reply = await this.callbacks.onQuestion(text);

      this.setState("speaking");
      await this.say(forSpeech(reply));
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

  private async say(text: string): Promise<void> {
    if (!text) return;
    this.speakAbort?.abort();
    const controller = new AbortController();
    this.speakAbort = controller;

    try {
      await getTts(this.config.ttsEngine).speak(text, {
        voice: this.config.ttsVoice,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        // Never let a TTS failure strand the conversation.
        this.callbacks.onError(`Speech failed: ${(err as Error).message}`);
      }
    } finally {
      if (this.speakAbort === controller) this.speakAbort = null;
    }
  }
}
