import { readCappedBytes } from "@/lib/tools/net-guard";
import type { VideoAspect, VideoQuality, VideoSeconds } from "./request";

/**
 * Video from Google's Veo models through the Gemini API — the one provider here
 * that makes the picture and its sound together: speech, effects and ambience
 * mixed into the clip.
 *
 * It is a paid model. It uses your Gemini key (`GEMINI_API_KEY` or the one in
 * Settings) and bills that Google account. The calls follow Google's published
 * REST shape for long-running generation: start an operation, poll it, then
 * download the file. The model is `JARVIS_VIDEO_MODEL` and the address
 * `JARVIS_GEMINI_VIDEO_URL`, both overridable (tests point them at a mock).
 *
 * The key is only ever sent to the configured address: a download link inside a
 * response that points anywhere else is fetched without it.
 */
export const DEFAULT_VIDEO_MODEL = "veo-3.0-generate-001";
const DEFAULT_BASE = "https://generativelanguage.googleapis.com";
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
export const VIDEO_USAGE_ID = "gemini:video";

export const videoModel = (): string => process.env.JARVIS_VIDEO_MODEL?.trim() || DEFAULT_VIDEO_MODEL;
export const videoBase = (): string => (process.env.JARVIS_GEMINI_VIDEO_URL || DEFAULT_BASE).replace(/\/+$/, "");
export const resolveVideoKey = (clientKey?: string | null): string | undefined => process.env.GEMINI_API_KEY || clientKey || undefined;

/** Operation names come back from the provider and go into a URL, so they must look like names. */
export function isOperationName(name: unknown): name is string {
  return typeof name === "string" && name.length <= 200 && /^[A-Za-z0-9_\-./]+$/.test(name) && !name.includes("..");
}

async function failure(res: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    const body = await res.json();
    detail = String(body?.error?.message ?? "").slice(0, 200);
  } catch {
    // Not JSON; the status says enough.
  }
  const hint = res.status === 403 || res.status === 401 ? " Check the Gemini key, and that its account can use Veo (it is a paid model)." : res.status === 429 ? " Rate or quota limit hit — wait, or check the account's quota." : "";
  return new Error(`${what} failed (${res.status}${detail ? `: ${detail}` : ""}).${hint}`);
}

export async function startVeo(o: {
  key: string;
  model: string;
  prompt: string;
  aspect: VideoAspect;
  seconds: VideoSeconds;
  quality: VideoQuality;
  avoid?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(`${videoBase()}/v1beta/models/${encodeURIComponent(o.model)}:predictLongRunning`, {
    method: "POST",
    signal: o.signal,
    headers: { "x-goog-api-key": o.key, "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: o.prompt }],
      parameters: {
        aspectRatio: o.aspect,
        durationSeconds: o.seconds,
        resolution: o.quality,
        ...(o.avoid ? { negativePrompt: o.avoid } : {}),
      },
    }),
  });
  if (!res.ok) throw await failure(res, "Starting the video");
  const json = await res.json().catch(() => ({}));
  if (!isOperationName(json?.name)) throw new Error("The video service didn't return a job to wait for.");
  return json.name;
}

export type VeoPoll = { done: false } | { done: true; uri: string } | { done: true; error: string };

export async function pollVeo(o: { key: string; name: string; signal?: AbortSignal }): Promise<VeoPoll> {
  const res = await fetch(`${videoBase()}/v1beta/${o.name}`, { signal: o.signal, headers: { "x-goog-api-key": o.key } });
  if (!res.ok) throw await failure(res, "Checking on the video");
  const json = await res.json().catch(() => ({}));
  if (!json?.done) return { done: false };
  if (json.error) return { done: true, error: String(json.error.message ?? "The video service reported an error.").slice(0, 300) };
  const response = json.response?.generateVideoResponse ?? json.response ?? {};
  const uri = response.generatedSamples?.[0]?.video?.uri;
  if (typeof uri === "string") return { done: true, uri };
  const reasons: unknown = response.raiMediaFilteredReasons;
  if (Array.isArray(reasons) && reasons.length) return { done: true, error: `The model declined this one: ${String(reasons[0]).slice(0, 250)}` };
  return { done: true, error: "The video service finished without a video." };
}

export async function downloadVeo(o: { key: string; uri: string; signal?: AbortSignal }): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(o.uri);
  } catch {
    throw new Error("The video service returned a link that isn't an address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The video link isn't a web address.");
  const trusted = url.origin === new URL(videoBase()).origin;
  const res = await fetch(url, { signal: o.signal, redirect: "follow", headers: trusted ? { "x-goog-api-key": o.key } : {} });
  if (!res.ok) throw await failure(res, "Downloading the video");
  return Buffer.from(await readCappedBytes(res, MAX_VIDEO_BYTES, true));
}
