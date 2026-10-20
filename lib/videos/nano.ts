import { guardedFetch, readCappedBytes } from "@/lib/tools/net-guard";
import type { VideoBackend, BackendPoll } from "./backend";
import { nearestSeconds, type VideoModel } from "./models";

/**
 * Video through NanoGPT's API, billed to the account the key belongs to.
 *
 * Submit with POST /api/generate-video, then poll GET /api/video/status until it
 * completes. NanoGPT's own documentation shows two shapes for the status
 * response (the examples nest everything under `data`, the OpenAPI schema is
 * flat) and two spellings of the states, so both are read, case-insensitively,
 * and anything unrecognised is "still going" rather than a failure. The key goes
 * in the `x-api-key` header and only ever to the configured address.
 */
const DEFAULT_BASE = "https://api.nano-gpt.com";
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
export const NANO_VIDEO_USAGE_ID = "nanogpt:video";

export const nanoVideoBase = (): string => (process.env.JARVIS_NANOGPT_VIDEO_URL || DEFAULT_BASE).replace(/\/+$/, "");

/** A job id from the provider goes into a URL, so it must look like an id. */
export const isRunId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_\-:.]{1,200}$/.test(v);

export interface NanoStatus {
  state: "pending" | "done" | "failed" | "cancelled";
  url?: string;
  error?: string;
  cost?: number;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Read a status response in either documented shape. Never throws. */
export function parseNanoStatus(json: unknown): NanoStatus {
  const root = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : {}) as Record<string, unknown>;
  const raw = String(data.status ?? root.status ?? "").toLowerCase().replace(/[\s_-]/g, "");
  const cost = typeof data.cost === "number" ? data.cost : typeof root.cost === "number" ? root.cost : undefined;
  const output = (data.output ?? root.output) as { video?: { url?: unknown } } | undefined;
  const url = str(output?.video?.url) ?? str(root.videoUrl) ?? str(data.videoUrl);

  if (raw === "completed" || raw === "complete" || raw === "succeeded" || raw === "done") {
    return url ? { state: "done", url, cost } : { state: "failed", error: "NanoGPT said the video was finished but gave no link to it.", cost };
  }
  if (raw === "failed" || raw === "error") {
    const why = str(data.userFriendlyError) ?? str(data.error) ?? str(root.error) ?? "NanoGPT reported that the video failed.";
    return { state: "failed", error: why.slice(0, 300), cost };
  }
  if (raw === "cancelled" || raw === "canceled") return { state: "cancelled", error: "NanoGPT cancelled the job.", cost };
  return { state: "pending", cost };
}

async function failure(res: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    const body = await res.json();
    detail = String(body?.message ?? body?.error?.message ?? (typeof body?.error === "string" ? body.error : "")).slice(0, 200);
  } catch {
    // Not JSON.
  }
  const hint =
    res.status === 401 || res.status === 403
      ? " Check the NanoGPT key."
      : res.status === 402
        ? " NanoGPT says the balance is too low for this video."
        : res.status === 429
          ? " Rate limit hit — wait a moment."
          : "";
  return new Error(`${what} failed (${res.status}${detail ? `: ${detail}` : ""}).${hint}`);
}

export function nanoBackend(key: string, model: VideoModel): VideoBackend {
  return {
    id: "nanogpt",
    model: model.id,
    async start(r, prompt, signal) {
      const seconds = nearestSeconds(model, r.seconds);
      const body: Record<string, unknown> = {
        model: model.id,
        prompt,
        duration: String(seconds),
        aspect_ratio: model.aspects.includes(r.aspect) ? r.aspect : model.aspects[0],
        ...(r.avoid ? { negative_prompt: r.avoid } : {}),
        ...(model.sound !== "no" ? { generateAudio: true } : {}),
        ...(model.family === "sora" ? { seconds: String(seconds), orientation: r.aspect === "9:16" ? "portrait" : "landscape" } : {}),
        ...(model.resolutions ? { resolution: model.resolutions.includes(r.quality) ? r.quality : model.resolutions[0] } : {}),
      };
      const res = await fetch(`${nanoVideoBase()}/api/generate-video`, { method: "POST", signal, headers: { "x-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw await failure(res, "Starting the video");
      const json = await res.json().catch(() => ({}));
      const id = json?.runId ?? json?.id;
      if (!isRunId(id)) throw new Error("NanoGPT didn't return a job to wait for.");
      return { handle: id, cost: typeof json?.cost === "number" ? json.cost : undefined, seconds };
    },
    async poll(handle, signal): Promise<BackendPoll> {
      const res = await fetch(`${nanoVideoBase()}/api/video/status?requestId=${encodeURIComponent(handle)}`, { signal, headers: { "x-api-key": key } });
      if (!res.ok) throw await failure(res, "Checking on the video");
      const s = parseNanoStatus(await res.json().catch(() => ({})));
      if (s.state === "pending") return { done: false };
      if (s.state === "done") return { done: true, uri: s.url!, cost: s.cost };
      return { done: true, error: s.error ?? "The video failed." };
    },
    async download(uri, signal) {
      let url: URL;
      try {
        url = new URL(uri);
      } catch {
        throw new Error("NanoGPT returned a link that isn't an address.");
      }
      // The link is on NanoGPT's storage, not its API host, so it gets the public-address guard and no key;
      // the configured API host itself (a test double, or a proxy) is trusted as is.
      const trusted = url.origin === new URL(nanoVideoBase()).origin;
      const response = trusted ? await fetch(url, { signal }) : (await guardedFetch(uri, { signal })).response;
      if (!response.ok) throw await failure(response, "Downloading the video");
      return Buffer.from(await readCappedBytes(response, MAX_VIDEO_BYTES, true));
    },
  };
}
