import { audit } from "@/lib/audit";
import { recordRequest } from "@/lib/providers/usage";
import { composeVideoPrompt, type VideoRequest } from "./request";
import { saveVideo, videoUrl } from "./store";
import { downloadVeo, pollVeo, startVeo, VIDEO_USAGE_ID } from "./veo";

/**
 * A video takes minutes, so asking for one starts a job and returns at once;
 * the page checks on it. Jobs live in memory — a restart loses a job in flight
 * (the provider may still have billed for it), and finished ones are forgotten
 * after ten minutes because the saved video is the record that matters.
 *
 * One job at a time, on purpose: a paid model plus a second tab pressed twice
 * should not be two bills. The key is held only in the running closure and is
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
}

interface Internal extends VideoJob {
  controller: AbortController;
}

const g = globalThis as unknown as { __jarvisVideoJobs?: Map<string, Internal> };
const jobs = (g.__jarvisVideoJobs ??= new Map());

const pollMs = () => Math.max(50, Number(process.env.JARVIS_VIDEO_POLL_MS) || 5000);
const timeoutMs = () => Math.max(1000, Number(process.env.JARVIS_VIDEO_TIMEOUT_MS) || 6 * 60_000);
const KEEP_FINISHED_MS = 10 * 60_000;

const publicJob = (j: Internal): VideoJob => ({ id: j.id, status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error, videoId: j.videoId, url: j.url });

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

export function startJob(o: { id: string; key: string; model: string; request: VideoRequest }): VideoJob {
  forget();
  const job: Internal = { id: o.id, status: "running", startedAt: Date.now(), controller: new AbortController() };
  jobs.set(job.id, job);
  const { signal } = job.controller;
  const r = o.request;

  void (async () => {
    try {
      const name = await startVeo({ key: o.key, model: o.model, prompt: composeVideoPrompt(r), aspect: r.aspect, seconds: r.seconds, quality: r.quality, avoid: r.avoid, signal });
      recordRequest(VIDEO_USAGE_ID, 0, 200);
      const deadline = Date.now() + timeoutMs();
      for (;;) {
        await sleep(pollMs(), signal);
        if (signal.aborted) {
          job.status = "cancelled";
          job.error = "Stopped. The provider may still have charged for it.";
          return;
        }
        if (Date.now() > deadline) throw new Error("The video took too long and was given up on. The provider may still finish and charge for it.");
        const polled = await pollVeo({ key: o.key, name, signal });
        if (!polled.done) continue;
        if ("error" in polled) throw new Error(polled.error);
        const bytes = await downloadVeo({ key: o.key, uri: polled.uri, signal });
        const meta = await saveVideo(bytes, { scene: r.scene, speech: r.speech || undefined, sound: r.sound || undefined, model: o.model, aspect: r.aspect, seconds: r.seconds, quality: r.quality });
        job.videoId = meta.id;
        job.url = videoUrl(meta.id);
        job.status = "done";
        audit("video.make", `${r.seconds}s ${r.aspect} ${r.quality}`);
        return;
      }
    } catch (err) {
      if (job.status === "running") {
        job.status = signal.aborted ? "cancelled" : "error";
        job.error = signal.aborted ? "Stopped." : (err as Error).message;
        if (!signal.aborted) recordRequest(VIDEO_USAGE_ID, 0, 500);
      }
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return publicJob(job);
}
