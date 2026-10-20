/**
 * Everything about asking for a video that doesn't touch the network: what a
 * request may contain, how the scene, the speech and the sound are put together
 * into the one prompt the model reads, and the daily spending guard.
 *
 * Veo makes its soundtrack from the prompt: speech in quotation marks is
 * spoken, and described sounds and ambience are mixed in. So "voices and noise"
 * here are not separate switches on the model — they are written into the prompt
 * from the fields the studio gives you.
 */
export const VIDEO_ASPECTS = ["16:9", "9:16"] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];
export const VIDEO_SECONDS = [4, 6, 8] as const;
export type VideoSeconds = (typeof VIDEO_SECONDS)[number];
export const VIDEO_QUALITIES = ["720p", "1080p"] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];

export const MAX_SCENE = 1200;
export const MAX_SPEECH = 400;
export const MAX_SOUND = 300;
export const MAX_AVOID_VIDEO = 200;

/** Words added to push toward live-action footage, not animation. */
export const REALISM = "photorealistic live-action footage, shot on a cinema camera, natural lighting, realistic motion and physics, true-to-life skin and textures";

export interface VideoRequest {
  scene: string;
  /** What is said aloud, in the words to be spoken. */
  speech: string;
  /** Sound effects and ambience, described. */
  sound: string;
  avoid: string;
  aspect: VideoAspect;
  seconds: VideoSeconds;
  quality: VideoQuality;
  realistic: boolean;
}

export type VideoRequestResult = { ok: true; request: VideoRequest } | { ok: false; error: string };

const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const isOf = <T extends readonly (string | number)[]>(list: T, v: unknown): v is T[number] => (list as readonly unknown[]).includes(v);

export function cleanVideoRequest(raw: unknown): VideoRequestResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Expected a JSON object." };
  const r = raw as Record<string, unknown>;
  const scene = oneLine(r.scene, MAX_SCENE);
  if (!scene) return { ok: false, error: "Describe the scene." };
  if (r.aspect !== undefined && !isOf(VIDEO_ASPECTS, r.aspect)) return { ok: false, error: "Aspect must be 16:9 or 9:16." };
  if (r.seconds !== undefined && !isOf(VIDEO_SECONDS, r.seconds)) return { ok: false, error: "Length must be 4, 6 or 8 seconds." };
  if (r.quality !== undefined && !isOf(VIDEO_QUALITIES, r.quality)) return { ok: false, error: "Quality must be 720p or 1080p." };
  if (r.realistic !== undefined && typeof r.realistic !== "boolean") return { ok: false, error: "realistic must be true or false." };
  const seconds = (r.seconds as VideoSeconds | undefined) ?? 8;
  const aspect = (r.aspect as VideoAspect | undefined) ?? "16:9";
  // 1080p is only offered by the model for a full 8 seconds in landscape; asking for it otherwise is quietly 720p.
  const quality = r.quality === "1080p" && seconds === 8 && aspect === "16:9" ? "1080p" : "720p";
  return {
    ok: true,
    request: {
      scene,
      speech: oneLine(r.speech, MAX_SPEECH).replace(/"/g, "'"),
      sound: oneLine(r.sound, MAX_SOUND),
      avoid: oneLine(r.avoid, MAX_AVOID_VIDEO),
      aspect,
      seconds,
      quality,
      realistic: r.realistic !== false,
    },
  };
}

/** The one prompt the model reads: scene, then what is said, then what is heard, then the look. */
export function composeVideoPrompt(r: Pick<VideoRequest, "scene" | "speech" | "sound" | "realistic">): string {
  const parts = [r.scene.replace(/[.\s]+$/, "") + "."];
  if (r.speech) parts.push(`Dialogue, spoken aloud in a natural voice: "${r.speech}"`);
  if (r.sound) parts.push(`Sound: ${r.sound.replace(/[.\s]+$/, "")}.`);
  else parts.push("Sound: natural ambient sound that fits the scene.");
  if (r.realistic) parts.push(`Look: ${REALISM}.`);
  return parts.join(" ");
}

/** How many videos may be made in a day before it asks you to raise the limit. Paid models make it easy to spend by accident. */
export function dailyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.JARVIS_VIDEO_DAILY_LIMIT;
  if (raw === undefined || raw === "") return 5;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 5;
}

/** How many of these creation times fall on `now`'s calendar day (server local time). */
export function madeToday(createdAt: number[], now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return createdAt.filter((t) => t >= start && t < start + 86_400_000).length;
}

export function underLimit(createdAt: number[], now = new Date(), limit = dailyLimit()): { ok: boolean; used: number; limit: number } {
  const used = madeToday(createdAt, now);
  return { ok: limit === 0 ? false : used < limit, used, limit };
}

/** The progress line for a job of this age, so a long wait says something true. */
export function waitLabel(elapsedSeconds: number): string {
  if (elapsedSeconds < 20) return "Sending the scene to the model…";
  if (elapsedSeconds < 90) return "Filming… this usually takes one to three minutes.";
  if (elapsedSeconds < 240) return "Still filming — longer clips take longer.";
  return "Taking longer than usual. It will stop by itself after about six minutes.";
}
