import { audit } from "@/lib/audit";
import { recordRequest } from "@/lib/providers/usage";
import type { VideoBackend } from "./backend";
import { composeVideoPrompt, type VideoRequest } from "./request";
import { saveVideo, videoUrl } from "./store";

/**
 * A video takes minutes, so asking for one starts a job and returns at once;
 * the page checks on it. Jobs live in memory — a restart loses a job in flight
 * (the provider may still have billed for it), and finished ones are forgotten
 * after ten minutes because the saved video is the record that matters.
 *
 * One job at a time, on purpose: a paid model plus a second tab pressed twice
 * should not be two bills. The key lives inside the backend closure and is
 * never stored on the job or sent to the page.
 */
export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface VideoJob {
  id: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  videoId?: string;
  url?: string;
  /** What the provider said it charged, in dollars. */
  cost?: number;
  provider?: string;
  model?: string;
}

interface Internal extends VideoJob {
  controller: AbortController;
}

const g = globalThis as unknown as { __jarvisVideoJobs?: Map<string, Internal> };
const jobs = (g.__jarvisVideoJobs ??= new Map());

const pollMs = () => Math.max(50, Number(process.env.JARVIS_VIDEO_POLL_MS) || 5000);
const timeoutMs = () => Math.max(1000, Number(process.env.JARVIS_VIDEO_TIMEOUT_MS) || 8 * 60_000);
const KEEP_FINISHED_MS = 10 * 60_000;

const publicJob = (j: Internal): VideoJob => ({ id: j.id, status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error, videoId: j.videoId, url: j.url, cost: j.cost, provider: j.provider, model: j.model });

function forget() {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.status !== "running" && j.finishedAt && now - j.finishedAt > KEEP_FINISHED_MS) jobs.delete(id);
}

export const runningJob = (): VideoJob | null => {
  for (const j of jobs.values()) if (j.status === "running") return publicJob(j);
  return null;
};
export const getJob = (id: string): VideoJob | null => (jobs.has(id) ? publicJob(jobs.get(id)!) : null);

export function cancelJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j || j.status !== "running") return false;
  j.controller.abort();
  return true;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

export function startJob(o: { id: string; backend: VideoBackend; request: VideoRequest; /** Whether this model makes sound, so the prompt describes it. */ sound: boolean }): VideoJob {
  forget();
  const { backend } = o;
  const job: Internal = { id: o.id, status: "running", startedAt: Date.now(), controller: new AbortController(), provider: backend.id, model: backend.model };
  jobs.set(job.id, job);
  const { signal } = job.controller;
  const r = o.request;
  const usageId = `${backend.id}:video`;

  void (async () => {
    try {
      const started = await backend.start(r, composeVideoPrompt(r, o.sound), signal);
      if (started.cost !== undefined) job.cost = started.cost;
      const seconds = started.seconds ?? r.seconds;
      recordRequest(usageId, 0, 200);
      const deadline = Date.now() + timeoutMs();
      for (;;) {
        await sleep(pollMs(), signal);
        if (signal.aborted) {
          job.status = "cancelled";
          job.error = "Stopped. The provider may still have charged for it.";
          return;
        }
        if (Date.now() > deadline) throw new Error("The video took too long and was given up on. The provider may still finish and charge for it.");
        const polled = await backend.poll(started.handle, signal);
        if (!polled.done) continue;
        if ("error" in polled) throw new Error(polled.error);
        if (polled.cost !== undefined) job.cost = polled.cost;
        const bytes = await backend.download(polled.uri, signal);
        const meta = await saveVideo(bytes, { scene: r.scene, speech: o.sound ? r.speech || undefined : undefined, sound: o.sound ? r.sound || undefined : undefined, model: backend.model, provider: backend.id, cost: job.cost, aspect: r.aspect, seconds, quality: r.quality });
        job.videoId = meta.id;
        job.url = videoUrl(meta.id);
        job.status = "done";
        audit("video.make", `${backend.id} ${backend.model} ${r.seconds}s ${r.aspect}`);
        return;
      }
    } catch (err) {
      if (job.status === "running") {
        job.status = signal.aborted ? "cancelled" : "error";
        job.error = signal.aborted ? "Stopped." : (err as Error).message;
        if (!signal.aborted) recordRequest(usageId, 0, 500);
      }
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return publicJob(job);
}
