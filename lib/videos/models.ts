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
  /** True when it costs nothing beyond your subscription — as the list says, or as you marked it. */
  free?: boolean;
  /** A line about the price, when the list gave one. */
  price?: string | null;
  description?: string;
  /** Whether this came from NanoGPT's live list or JARVIS's built-in one. */
  source?: "live" | "builtin";
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

/**
 * The model to use out of the models on offer: the one asked for, or null if it
 * isn't on offer (an unknown id is an error, never a quiet swap to something that
 * costs differently); with none asked for, JARVIS_NANOGPT_VIDEO_MODEL, then Veo 3,
 * then the first.
 */
export function resolveNanoModel(requested: string | undefined, models: VideoModel[], env: Record<string, string | undefined> = process.env): VideoModel | null {
  if (requested) return models.find((m) => m.id === requested) ?? null;
  const preferred = env.JARVIS_NANOGPT_VIDEO_MODEL?.trim();
  return (preferred && models.find((m) => m.id === preferred)) || models.find((m) => m.id === DEFAULT_NANO_VIDEO_MODEL) || models[0] || null;
}

/** The nearest length the model takes (the first if it is a tie, so it errs shorter and cheaper). */
export function nearestSeconds(model: VideoModel, wanted: number): number {
  return model.seconds.reduce((best, s) => (Math.abs(s - wanted) < Math.abs(best - wanted) ? s : best), model.seconds[0]);
}

/** Free ones first, then paid, each by name — the order the studio shows its two sections in. */
export function splitFreePaid(models: VideoModel[]): { free: VideoModel[]; paid: VideoModel[] } {
  const by = (a: VideoModel, b: VideoModel) => a.label.localeCompare(b.label);
  return { free: models.filter((m) => m.free).sort(by), paid: models.filter((m) => !m.free).sort(by) };
}
