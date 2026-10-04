import { Speaker } from "../tts/speaker";
import { forSpeech } from "../tts/types";
import { WakeGate } from "../wake/types";
import { DEFAULT_GREETING, isNoise, STOP_WORDS } from "../phrases";
import { FRAME_SAMPLES, SAMPLE_RATE, audioStatus, startCapture, type CaptureHandle } from "./audio";
import { DeviceWakeWord } from "./wake";
import { DeviceVad } from "./vad";
import { SpeechSegmenter } from "./segment";
import { PiperTts } from "./piper-tts";
import { ask, transcribeAudio } from "./client";
import { detectDevice } from "./detect";
import { piperStatus } from "./piper";
import { display, displayConnected } from "@/lib/display";

/**
 * The voice loop, running on the device itself.
 *
 * The browser session is the same idea with different plumbing: there, audio
 * comes from an AudioWorklet and speech goes to an <audio> element; here both
 * are processes on a Raspberry Pi, and there is no browser in the path at
 * all. Everything between — wake word, turn taking, transcription, the
 * sentence pipeline — is the same code.
 *
 * It listens all the time, by design. Nothing leaves the device until a turn
 * completes: the wake word and VAD are local models, and only the audio of a
 * finished utterance is ever uploaded.
 */

export type DeviceState =
  | "off"
  | "starting"
  | "idle"          // waiting for the wake word
  | "listening"     // hearing speech that will become a turn
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export interface DeviceConfig {
  /**
   * Require "Hey JARVIS" before answering.
   *
   * Off is the always-on mode: Silero decides when someone is talking and
   * JARVIS answers. Pleasant in a room you're alone in, chaotic in one with
   * a television, which is why it stays a setting.
   */
  requireWakeWord: boolean;
  wakeThreshold: number;
  vadThreshold: number;
  greeting: string;
  /** Piper voice id; defaults to the best one this machine can keep up with. */
  voice?: string;
  speed?: number;
  /** ALSA capture device, e.g. "plughw:1,0". */
  captureDevice?: string;
  /**
   * Ignore the microphone while speaking.
   *
   * A Pi with a USB mic and a Bluetooth speaker has no echo cancellation, so
   * with this off JARVIS hears its own voice, transcribes it, and answers
   * itself — forever. The wake word still runs during playback, so saying
   * "Hey JARVIS" over the top still interrupts.
   */
  halfDuplex: boolean;
  /** How long a wake word keeps the floor open, in ms. */
  armedMs: number;
  /** Turns of context kept between questions. */
  historyTurns: number;
  /**
   * Put each answer on the room display as well as speaking it.
   *
   * Off by default. A screen lighting up for "what time is it" is worse than
   * no screen, and this is the first thing JARVIS does that is visible from
   * across a room — so it waits to be asked for.
   */
  showOnDisplay: boolean;
}

export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  requireWakeWord: true,
  wakeThreshold: 0.5,
  vadThreshold: 0.5,
  greeting: DEFAULT_GREETING,
  halfDuplex: true,
  armedMs: 12_000,
  historyTurns: 6,
  showOnDisplay: false,
};

export interface DeviceDiagnostics {
  state: DeviceState;
  /** Frames captured. Zero after startup means the microphone isn't working. */
  frames: number;
  /** Frames whose wake-word score was computed; far below `frames` means the
   *  machine can't keep up and the wake word will start missing. */
  scored: number;
  /** Frames waiting to be processed. Persistently high is the same warning. */
  backlog: number;
  level: number;
  peakLevel: number;
  wakeScore: number;
  peakWakeScore: number;
  speechProbability: number;
  muted: boolean;
  armed: boolean;
  turns: number;
  lastTranscript: string;
  lastReply: string;
  /** Time from end of speech to first audio out, in ms. */
  responseMs: number;
  problem?: string;
}

export interface DeviceEvents {
  onState?(state: DeviceState): void;
  onDiagnostics?(diagnostics: DeviceDiagnostics): void;
  onTranscript?(text: string): void;
  onReply?(text: string): void;
  onError?(message: string): void;
}

type Turn = { role: "user" | "assistant"; content: string };

export class DeviceVoiceSession {
  private config: DeviceConfig;
  private events: DeviceEvents;

  private capture: CaptureHandle | null = null;
  private wake = new DeviceWakeWord();
  private vad = new DeviceVad();
  private segmenter: SpeechSegmenter;
  private wakeGate: WakeGate;
  private tts = new PiperTts();
  private speaker: Speaker | null = null;

  private state: DeviceState = "off";
  private frameIndex = 0;
  private muted = false;
  private armedUntil = 0;
  private history: Turn[] = [];
  private turnAbort: AbortController | null = null;
  private speechEndedAt = 0;

  /**
   * Frames are handled one at a time, in order.
   *
   * Silero is recurrent and the wake word slides a window: both produce
   * confident nonsense if frames arrive out of order or overlap. A promise
   * chain is the cheapest way to guarantee neither happens.
   */
  private chain: Promise<void> = Promise.resolve();
  private backlog = 0;

  private diagnostics: DeviceDiagnostics = {
    state: "off", frames: 0, scored: 0, backlog: 0, level: 0, peakLevel: 0,
    wakeScore: 0, peakWakeScore: 0, speechProbability: 0, muted: false,
    armed: false, turns: 0, lastTranscript: "", lastReply: "", responseMs: 0,
  };

  constructor(config: Partial<DeviceConfig> = {}, events: DeviceEvents = {}) {
    this.config = { ...DEFAULT_DEVICE_CONFIG, ...config };
    this.events = events;
    this.wakeGate = new WakeGate(this.config.wakeThreshold);
    this.segmenter = new SpeechSegmenter({
      positiveThreshold: this.config.vadThreshold,
      negativeThreshold: Math.max(0.1, this.config.vadThreshold - 0.15),
    });
  }

  updateConfig(config: Partial<DeviceConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.wakeThreshold !== undefined) this.wakeGate = new WakeGate(config.wakeThreshold);
    if (config.vadThreshold !== undefined) {
      this.segmenter = new SpeechSegmenter({
        positiveThreshold: config.vadThreshold,
        negativeThreshold: Math.max(0.1, config.vadThreshold - 0.15),
      });
    }
  }

  get isRunning(): boolean {
    return this.capture !== null;
  }

  snapshot(): DeviceDiagnostics {
    return {
      ...this.diagnostics,
      state: this.state,
      backlog: this.backlog,
      muted: this.muted,
      armed: Date.now() < this.armedUntil,
    };
  }

  /**
   * The pre-flight every piece of hardware gets checked by.
   *
   * Four things have to be true for voice to work on a box in a room, and
   * three of them are physical. Reporting which one is missing is the only
   * useful thing to do about hardware that isn't here.
   */
  async status(): Promise<{ ok: boolean; problems: string[]; device: string }> {
    const [audio, piper, info] = await Promise.all([
      audioStatus(),
      piperStatus(),
      detectDevice(),
    ]);

    const problems: string[] = [];
    if (audio.problem) problems.push(audio.problem);
    if (piper.problem) problems.push(piper.problem);

    return {
      ok: problems.length === 0,
      problems,
      device: `${info.model} (${info.deviceClass}, ${info.arch}) — ${info.suggestedQuality} voice`,
    };
  }

  async start(): Promise<void> {
    if (this.capture) return;
    this.setState("starting");

    const status = await this.status();
    if (!status.ok) {
      const problem = status.problems.join(" ");
      this.diagnostics.problem = problem;
      this.events.onError?.(problem);
      this.setState("error");
      throw new Error(problem);
    }

    await Promise.all([
      this.config.requireWakeWord ? this.wake.load() : Promise.resolve(),
      this.vad.load(),
      this.tts.check(),
    ]);

    this.capture = startCapture(
      (samples, rms) => this.enqueue(samples, rms),
      {
        device: this.config.captureDevice,
        onError: (message) => {
          this.diagnostics.problem = message;
          this.events.onError?.(message);
        },
      },
    );

    this.setState("idle");
  }

  async stop(): Promise<void> {
    this.capture?.stop();
    this.capture = null;
    this.turnAbort?.abort();
    this.turnAbort = null;
    this.speaker?.cancel();
    this.speaker = null;
    this.tts.cancel();
    this.wake.dispose();
    this.vad.dispose();
    this.segmenter.reset();
    this.setState("off");
  }

  /** Stop listening without releasing the microphone. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.segmenter.reset();
      this.vad.reset();
      this.wake.reset();
      this.interrupt();
    }
    this.emit();
  }

  /** Barge-in: stop talking immediately. */
  interrupt(): void {
    this.speaker?.cancel();
    this.tts.cancel();
    this.turnAbort?.abort();
  }

  /** Forget the conversation so far. */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Say something nobody asked for — a reminder, a briefing, a watcher.
   *
   * Refused while muted: muting the box means it should not make noise, and a
   * scheduled task is exactly the thing that would otherwise ignore that at
   * two in the morning. Refused mid-turn too, because cutting across your own
   * answer to read a reminder is worse than reading it a moment later.
   *
   * Fire-and-forget by design: the caller is a timer with nowhere to report,
   * and a failed announcement must not take the scheduler down with it.
   */
  announce(text: string): boolean {
    const spoken = text.trim();
    if (!spoken) return false;
    if (this.muted) return false;
    if (this.state === "off" || this.state === "error") return false;
    // Listening or already talking: the user has the floor.
    if (this.state === "listening" || this.state === "thinking" || this.state === "speaking") {
      return false;
    }

    void this.speak(spoken).catch((err) => {
      this.events.onError?.(`Announcement failed: ${(err as Error).message}`);
    });
    return true;
  }

  private setState(state: DeviceState): void {
    this.state = state;
    this.diagnostics.state = state;
    this.events.onState?.(state);
    this.emit();
  }

  private emit(): void {
    this.events.onDiagnostics?.(this.snapshot());
  }

  private enqueue(samples: Float32Array, rms: number): void {
    this.backlog++;
    this.chain = this.chain
      .then(() => this.handleFrame(samples, rms))
      .catch((err) => {
        // One bad frame must not kill the loop; the next one gets a fresh go.
        this.events.onError?.(`Audio frame failed: ${(err as Error).message}`);
      })
      .finally(() => {
        this.backlog--;
      });
  }

  private async handleFrame(samples: Float32Array, rms: number): Promise<void> {
    this.frameIndex++;
    this.diagnostics.frames++;
    this.diagnostics.level = rms;
    if (rms > this.diagnostics.peakLevel) this.diagnostics.peakLevel = rms;

    if (this.muted) return;

    await this.runWakeWord(samples);

    // Half-duplex: while JARVIS has the speaker, the microphone is only
    // watched for the wake word. Otherwise it hears itself and answers.
    const busyTurn =
      this.state === "transcribing" || this.state === "thinking" || this.state === "speaking";
    if (busyTurn && this.config.halfDuplex) return;

    await this.runVad(samples);

    if (this.frameIndex % 6 === 0) this.emit();
  }

  private async runWakeWord(samples: Float32Array): Promise<void> {
    if (!this.config.requireWakeWord) return;
    if (!this.wake.isLoaded) return;

    // Buffering is cheap and must happen for every frame: a gap in the window
    // means the wake word simply never matches again.
    this.wake.append(samples);

    // Scoring is what falls behind on a slow machine, and skipping it is
    // harmless — the next frame scores a window that still contains the word.
    if (this.backlog > 3) return;

    const score = await this.wake.score();
    this.diagnostics.scored++;
    this.diagnostics.wakeScore = score;
    if (score > this.diagnostics.peakWakeScore) this.diagnostics.peakWakeScore = score;

    if (this.wakeGate.accept(score, this.frameIndex)) this.onWake();
  }

  private onWake(): void {
    this.wake.reset();
    this.armedUntil = Date.now() + this.config.armedMs;

    // Mid-answer, "Hey JARVIS" means stop and listen.
    if (this.state === "speaking" || this.state === "thinking") {
      this.interrupt();
      this.setState("idle");
      return;
    }

    // The greeting runs off the frame chain: waiting for it here would stall
    // capture for a second and lose the start of the question.
    void this.greet();
  }

  private async greet(): Promise<void> {
    if (!this.config.greeting) return;
    this.setState("speaking");
    try {
      await this.speak(this.config.greeting);
    } catch {
      /* the error path already reported it */
    }
    // The clock starts after the greeting, not before it.
    this.armedUntil = Date.now() + this.config.armedMs;
    if (this.state === "speaking") this.setState("idle");
  }

  private async runVad(samples: Float32Array): Promise<void> {
    for (const { probability, window } of await this.vad.process(samples)) {
      this.diagnostics.speechProbability = probability;
      const event = this.segmenter.push(probability, window);

      if (event.type === "start") {
        if (this.state === "speaking" && !this.config.halfDuplex) this.interrupt();
        if (this.state === "idle" && this.hasFloor()) this.setState("listening");
      } else if (event.type === "end") {
        this.speechEndedAt = Date.now();
        if (this.hasFloor()) {
          // Off the chain: a turn takes seconds and capture must not stall.
          void this.runTurn(event.audio);
        } else if (this.state === "listening") {
          this.setState("idle");
        }
      } else if (event.type === "discard" && this.state === "listening") {
        this.setState("idle");
      }
    }
  }

  /** Is speech right now meant for JARVIS? */
  private hasFloor(): boolean {
    if (!this.config.requireWakeWord) return true;
    return Date.now() < this.armedUntil;
  }

  private async runTurn(audio: Float32Array): Promise<void> {
    if (this.state === "transcribing" || this.state === "thinking") return;

    const abort = new AbortController();
    this.turnAbort = abort;
    this.setState("transcribing");

    try {
      const text = await transcribeAudio(audio, abort.signal);

      if (!text || isNoise(text)) return this.finishTurn();
      this.diagnostics.lastTranscript = text;
      this.events.onTranscript?.(text);

      if (STOP_WORDS.test(text)) {
        this.armedUntil = 0;
        this.history = [];
        await this.speak("Goodbye, sir.");
        return this.finishTurn();
      }

      this.setState("thinking");

      const speaker = this.freshSpeaker();
      let pushed = 0;
      let started = false;

      /**
       * Clean the CUMULATIVE reply and push only the new tail.
       *
       * Cleaning each delta on its own eats the space between two streamed
       * tokens, so words run together — "sentence " + "number" becomes
       * "sentencenumber".
       */
      const feed = (soFar: string) => {
        const cleaned = forSpeech(soFar);
        const fresh = cleaned.slice(pushed);
        if (!fresh) return;
        pushed = cleaned.length;
        if (!started) {
          started = true;
          this.setState("speaking");
        }
        speaker.push(fresh);
      };

      const reply = await ask(text, {
        history: this.history.slice(-this.config.historyTurns),
        signal: abort.signal,
        onToken: feed,
        onApproval: (summary) => {
          this.events.onError?.(`Waiting on approval: ${summary}`);
        },
      });

      feed(reply);
      speaker.end();
      this.setState("speaking");
      await speaker.wait();

      this.diagnostics.lastReply = reply;
      this.events.onReply?.(reply);

      // The wall gets the answer too, when asked for and when anything is
      // there to show it. Spoken replies are deliberately short — the screen
      // is where the rest of an answer can live.
      if (this.config.showOnDisplay && reply.trim() && displayConnected()) {
        await display
          .show({ kind: "markdown", body: reply, title: text.slice(0, 80) })
          .catch((err) => this.events.onError?.(`Display failed: ${(err as Error).message}`));
      }
      this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      this.diagnostics.turns++;

      // Answering keeps the conversation open, so a follow-up doesn't need
      // the wake word again.
      this.armedUntil = Date.now() + this.config.armedMs;
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        const message = (err as Error).message;
        this.diagnostics.problem = message;
        this.events.onError?.(message);
      }
    } finally {
      this.finishTurn();
    }
  }

  private finishTurn(): void {
    this.turnAbort = null;
    // The room is still ringing with the last word; clear the detectors so
    // the tail of JARVIS's own voice doesn't open a new turn.
    this.segmenter.reset();
    this.vad.reset();
    if (this.state !== "off" && this.state !== "error") this.setState("idle");
  }

  private async speak(text: string): Promise<void> {
    const speaker = this.freshSpeaker();
    speaker.say(text);
    await speaker.wait();
  }

  private freshSpeaker(): Speaker {
    this.speaker?.cancel();
    this.speaker = new Speaker(
      this.tts,
      { voice: this.config.voice, rate: this.config.speed },
      (message) => this.events.onError?.(`Speech failed: ${message}`),
      ({ firstAudio }) => {
        if (firstAudio && this.speechEndedAt) {
          this.diagnostics.responseMs = Date.now() - this.speechEndedAt;
        }
      },
    );
    return this.speaker;
  }
}

export const DEVICE_AUDIO = { SAMPLE_RATE, FRAME_SAMPLES };
