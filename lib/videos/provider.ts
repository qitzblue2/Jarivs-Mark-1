import type { VideoBackend } from "./backend";
import { NANO_VIDEO_MODELS, pickNanoModel, type VideoModel } from "./models";
import { nanoBackend } from "./nano";
import { geminiBackend, resolveVideoKey, videoModel } from "./veo";

/**
 * Which service makes the video. NanoGPT comes first whenever a NanoGPT key is
 * present (the server's `NANOGPT_API_KEY` or the one in Settings) — it is the
 * account most people have billing on — and a Gemini key is the fallback.
 * `JARVIS_VIDEO_PROVIDER=gemini` (or `nanogpt`) forces one.
 */
export type VideoProviderId = "nanogpt" | "gemini";

export interface Keys {
  nanogpt?: string;
  gemini?: string;
}

export const resolveNanoKey = (client?: string | null, env: Record<string, string | undefined> = process.env): string | undefined => env.NANOGPT_API_KEY || client || undefined;

export function pickProvider(keys: Keys, env: Record<string, string | undefined> = process.env): VideoProviderId | null {
  const nano = Boolean(keys.nanogpt);
  const gem = Boolean(keys.gemini);
  const forced = env.JARVIS_VIDEO_PROVIDER;
  if (forced === "nanogpt") return nano ? "nanogpt" : null;
  if (forced === "gemini") return gem ? "gemini" : null;
  return nano ? "nanogpt" : gem ? "gemini" : null;
}

export interface Chosen {
  backend: VideoBackend;
  provider: VideoProviderId;
  /** The model's details, for NanoGPT (which has a list). Gemini has one model. */
  model: VideoModel | null;
  /** Whether this model is documented as making sound. */
  sound: "yes" | "unknown" | "no";
}

export function chooseBackend(keys: Keys, requestedModel: string | undefined, env: Record<string, string | undefined> = process.env): Chosen | null {
  const provider = pickProvider(keys, env);
  if (provider === "nanogpt") {
    const model = pickNanoModel(requestedModel, env);
    return { backend: nanoBackend(keys.nanogpt!, model), provider, model, sound: model.sound };
  }
  if (provider === "gemini") return { backend: geminiBackend(keys.gemini!, videoModel()), provider, model: null, sound: "yes" };
  return null;
}

/** What the studio is told: who would make the video and which models it can pick. */
export function describeVideo(keys: Keys, env: Record<string, string | undefined> = process.env) {
  const provider = pickProvider(keys, env);
  return {
    provider,
    available: provider !== null,
    models: provider === "nanogpt" ? NANO_VIDEO_MODELS : [],
    model: provider === "nanogpt" ? pickNanoModel(undefined, env).id : provider === "gemini" ? videoModel() : null,
  };
}

export { resolveVideoKey };
