import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Microphone and speaker on the device itself.
 *
 * Driven by spawning `arecord` and `aplay` rather than binding a native audio
 * module. Native bindings mean compiling against ALSA headers on ARM, which
 * is a reliable way to lose an afternoon; spawning is dull and works on every
 * Pi image out of the box.
 */

export const SAMPLE_RATE = 16000;
/** 1280 samples = 80ms, the frame size openWakeWord expects. */
export const FRAME_SAMPLES = 1280;

export interface AudioStatus {
  capture: boolean;
  playback: boolean;
  /** Input devices `arecord -l` can see. */
  inputs: string[];
  outputs: string[];
  problem?: string;
}

async function has(tool: string): Promise<boolean> {
  try {
    await run("which", [tool]);
    return true;
  } catch {
    return false;
  }
}

function parseDevices(output: string): string[] {
  return [...output.matchAll(/^card \d+: (.+?) \[(.+?)\].*$/gm)].map((m) => m[2]);
}

/**
 * What audio hardware is actually present.
 *
 * Reported rather than assumed: this runs on a box with a microphone someone
 * plugged in and a Bluetooth speaker that may or may not be paired, so
 * "it didn't work" needs to name a cause.
 */
export async function audioStatus(): Promise<AudioStatus> {
  const [capture, playback] = await Promise.all([has("arecord"), has("aplay")]);

  if (!capture || !playback) {
    return {
      capture,
      playback,
      inputs: [],
      outputs: [],
      problem: "ALSA tools missing. Install with: sudo apt install alsa-utils",
    };
  }

  const inputs = await run("arecord", ["-l"]).then((r) => parseDevices(r.stdout)).catch(() => []);
  const outputs = await run("aplay", ["-l"]).then((r) => parseDevices(r.stdout)).catch(() => []);

  return {
    capture,
    playback,
    inputs,
    outputs,
    problem:
      inputs.length === 0
        ? "No microphone detected. Plug one in and check `arecord -l`."
        : outputs.length === 0
          ? "No speaker detected. For the JBL Go, pair it first and check `aplay -l`."
          : undefined,
  };
}

export interface CaptureHandle {
  stop(): void;
}

/**
 * Stream microphone audio as 16kHz mono frames.
 *
 * `arecord` writes raw signed 16-bit LE to stdout; it's converted to the
 * Float32 frames the wake word and VAD models expect, buffered to exact
 * frame boundaries so a partial read never produces a short frame.
 */
export function startCapture(
  onFrame: (samples: Float32Array, rms: number) => void,
  options: { device?: string; onError?: (message: string) => void } = {},
): CaptureHandle {
  const args = [
    "-q",
    "-t", "raw",
    "-f", "S16_LE",
    "-r", String(SAMPLE_RATE),
    "-c", "1",
  ];
  if (options.device) args.push("-D", options.device);

  let child: ChildProcess | null = spawn("arecord", args, { stdio: ["ignore", "pipe", "pipe"] });
  // Typed against ArrayBufferLike because subarray() widens the buffer type.
  let leftover: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const bytesPerFrame = FRAME_SAMPLES * 2;

  child.stdout?.on("data", (chunk: Buffer) => {
    let buffer = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;

    while (buffer.length >= bytesPerFrame) {
      const slice = buffer.subarray(0, bytesPerFrame);
      buffer = buffer.subarray(bytesPerFrame);

      const samples = new Float32Array(FRAME_SAMPLES);
      let sum = 0;
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const value = slice.readInt16LE(i * 2) / 32768;
        samples[i] = value;
        sum += value * value;
      }
      onFrame(samples, Math.sqrt(sum / FRAME_SAMPLES));
    }

    leftover = buffer;
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) options.onError?.(text.slice(0, 200));
  });

  child.on("error", (err) => options.onError?.(`arecord failed: ${err.message}`));

  return {
    stop() {
      child?.kill("SIGTERM");
      child = null;
    },
  };
}

/**
 * Play a WAV buffer through the speaker.
 *
 * Bluetooth adds 100-200ms before the first sound, which is why speech is
 * generated a sentence ahead rather than on demand.
 */
export function play(wav: Uint8Array, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("aplay", ["-q", "-"], { stdio: ["pipe", "ignore", "pipe"] });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(`aplay failed: ${err.message}`));
    });

    child.on("close", (code, terminated) => {
      signal?.removeEventListener("abort", onAbort);
      if (terminated) return reject(new DOMException("Playback cancelled", "AbortError"));
      if (code !== 0 && stderr) {
        // A speaker that vanished mid-sentence should say so, not fail mute.
        return reject(new Error(`Playback failed: ${stderr.slice(0, 160)}`));
      }
      resolve();
    });

    child.stdin?.write(wav);
    child.stdin?.end();
  });
}
