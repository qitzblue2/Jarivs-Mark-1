/**
 * The video models offered through NanoGPT, and what is known about each. This
 * list comes from NanoGPT's own documentation, and the documentation is thin:
 * only `veo3-video` is documented as making sound, so the others are marked
 * "unknown" rather than promised. JARVIS asks every Veo model and Sora for audio
 * and tells you plainly that it may come back silent.
 */
export type SoundSupport = "yes" | "unknown" | "no";

export interface VideoModel {
  id: string;
  label: string;
  sound: SoundSupport;
  /** Lengths the model takes, in seconds. */
  seconds: number[];
  aspects: string[];
  /** Resolutions to send, if the model takes one. Others get none. */
  resolutions?: string[];
  /** Sora names its length and shape differently. */
  family?: "sora";
}

export const NANO_VIDEO_MODELS: VideoModel[] = [
  { id: "veo3-video", label: "Veo 3 — with sound", sound: "yes", seconds: [8], aspects: ["16:9", "9:16"] },
  { id: "veo3-1-video", label: "Veo 3.1", sound: "unknown", seconds: [4, 6, 8], aspects: ["16:9", "9:16"] },
  { id: "veo3-fast-video", label: "Veo 3 Fast", sound: "unknown", seconds: [4, 6, 8], aspects: ["16:9", "9:16"] },
  { id: "sora-2", label: "Sora 2", sound: "unknown", seconds: [4, 8, 12], aspects: ["16:9", "9:16"], family: "sora" },
  { id: "kling-video-v2", label: "Kling 2 — silent", sound: "no", seconds: [5, 10], aspects: ["16:9", "9:16"] },
  { id: "seedance-video", label: "Seedance — silent", sound: "no", seconds: [5, 10], aspects: ["16:9", "9:16"], resolutions: ["480p", "1080p"] },
];

export const DEFAULT_NANO_VIDEO_MODEL = "veo3-video";

export const findNanoModel = (id: string): VideoModel | undefined => NANO_VIDEO_MODELS.find((m) => m.id === id);

/** The model to use: the one asked for if we know it, else JARVIS_NANOGPT_VIDEO_MODEL, else Veo 3. */
export function pickNanoModel(requested: string | undefined, env: Record<string, string | undefined> = process.env): VideoModel {
  return (requested && findNanoModel(requested)) || (env.JARVIS_NANOGPT_VIDEO_MODEL && findNanoModel(env.JARVIS_NANOGPT_VIDEO_MODEL.trim())) || findNanoModel(DEFAULT_NANO_VIDEO_MODEL)!;
}

/** The nearest length the model takes (the first if it is a tie, so it errs shorter and cheaper). */
export function nearestSeconds(model: VideoModel, wanted: number): number {
  return model.seconds.reduce((best, s) => (Math.abs(s - wanted) < Math.abs(best - wanted) ? s : best), model.seconds[0]);
}
