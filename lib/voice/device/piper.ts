import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { detectDevice, type VoiceQuality } from "./detect";

/**
 * Piper: neural speech that runs on a Raspberry Pi's CPU.
 *
 * Kokoro is the right engine in a browser and the wrong one on a Pi — it
 * wants WebGPU, which a Pi does not meaningfully have. Piper is built for
 * exactly this hardware: a Pi 5 synthesises its medium voices in real time on
 * CPU alone. Measured here on x86 at 0.17x realtime for the low voice.
 *
 * It's driven by spawning the binary rather than binding to a native module,
 * because compiling audio bindings against ALSA on ARM is a weekend nobody
 * gets back.
 */

export const PIPER_DIR = path.join(process.cwd(), "vendor", "piper");
export const VOICE_DIR = path.join(PIPER_DIR, "voices");

export interface PiperVoice {
  id: string;
  label: string;
  quality: VoiceQuality;
  /** Release asset name, for the setup script. */
  asset: string;
}

/**
 * Voices published as GitHub release assets.
 *
 * Deliberately not the HuggingFace catalogue: these are fetchable without an
 * account, which keeps the "free forever, no signup" property intact and
 * means the setup script works in a locked-down network.
 */
export const PIPER_VOICES: PiperVoice[] = [
  { id: "en-gb-alan-low", label: "Alan — British, low", quality: "low", asset: "voice-en-gb-alan-low.tar.gz" },
  { id: "en-us-amy-low", label: "Amy — American, low", quality: "low", asset: "voice-en-us-amy-low.tar.gz" },
  { id: "en-us-lessac-medium", label: "Lessac — American, medium", quality: "medium", asset: "voice-en-us-lessac-medium.tar.gz" },
  { id: "en-us-ryan-high", label: "Ryan — American, high", quality: "high", asset: "voice-en-us-ryan-high.tar.gz" },
];

export function voiceFor(quality: VoiceQuality): PiperVoice {
  return (
    PIPER_VOICES.find((v) => v.quality === quality) ??
    PIPER_VOICES.find((v) => v.quality === "low") ??
    PIPER_VOICES[0]
  );
}

const exists = (p: string) => fs.access(p).then(() => true).catch(() => false);

export interface PiperStatus {
  installed: boolean;
  binary: string | null;
  voices: string[];
  /** Why it isn't usable, for the diagnostics panel. */
  problem?: string;
}

/** What's actually on disk — the hardware diagnostic for speech. */
export async function piperStatus(): Promise<PiperStatus> {
  const binary = path.join(PIPER_DIR, "piper");

  if (!(await exists(binary))) {
    return {
      installed: false,
      binary: null,
      voices: [],
      problem: "Piper is not installed. Run `npm run setup:device`.",
    };
  }

  let voices: string[] = [];
  try {
    voices = (await fs.readdir(VOICE_DIR)).filter((f) => f.endsWith(".onnx"));
  } catch {
    /* directory missing entirely */
  }

  if (voices.length === 0) {
    return {
      installed: false,
      binary,
      voices: [],
      problem: "Piper is installed but has no voice model. Run `npm run setup:device`.",
    };
  }

  return { installed: true, binary, voices };
}

/** Pick the configured voice, or the best one present for this machine. */
export async function resolveVoice(preferred?: string): Promise<string | null> {
  const status = await piperStatus();
  if (!status.installed) return null;

  if (preferred) {
    const match = status.voices.find((v) => v.startsWith(preferred));
    if (match) return path.join(VOICE_DIR, match);
  }

  const device = await detectDevice();
  const wanted = voiceFor(device.suggestedQuality);
  const match =
    status.voices.find((v) => v.startsWith(wanted.id)) ?? status.voices[0];

  return path.join(VOICE_DIR, match);
}

export interface SynthesisResult {
  /** 16-bit PCM WAV. */
  wav: Buffer;
  ms: number;
}

/**
 * Synthesise to a WAV buffer.
 *
 * Piper writes raw audio to stdout with `--output_file -`, so nothing touches
 * the disk per sentence — which matters on a Pi running from an SD card.
 */
export async function synthesize(
  text: string,
  options: { voice?: string; speed?: number; signal?: AbortSignal } = {},
): Promise<SynthesisResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to speak.");

  const status = await piperStatus();
  if (!status.installed || !status.binary) {
    throw new Error(status.problem ?? "Piper is unavailable.");
  }

  const model = await resolveVoice(options.voice);
  if (!model) throw new Error("No Piper voice model found.");

  const started = Date.now();

  return new Promise<SynthesisResult>((resolve, reject) => {
    const args = ["--model", model, "--output_file", "-"];
    // Piper's length_scale is inverse to speed: lower speaks faster.
    if (options.speed && options.speed !== 1) {
      args.push("--length_scale", String(1 / options.speed));
    }

    // The binary's path is discovered at runtime, not known at build time;
    // the build's tracing warning doesn't apply to a self-hosted install.
    const child = spawn(/*turbopackIgnore: true*/ status.binary!, args, {
      cwd: PIPER_DIR,
      signal: options.signal,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => reject(new Error(`Piper failed to start: ${err.message}`)));

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Piper exited with ${code}: ${stderr.slice(0, 200)}`));
      }
      const wav = Buffer.concat(chunks);
      if (wav.length < 64) {
        return reject(new Error(`Piper produced no audio. ${stderr.slice(0, 200)}`));
      }
      resolve({ wav, ms: Date.now() - started });
    });

    child.stdin.write(trimmed);
    child.stdin.end();
  });
}
