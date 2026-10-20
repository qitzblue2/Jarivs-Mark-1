import type { VideoRequest } from "./request";

/**
 * What a video service has to do for the job runner: start a job, say how it
 * is getting on, and hand over the file. Two exist — NanoGPT (nano.ts) and
 * Google's Veo through a Gemini key (veo.ts) — and the runner (jobs.ts) neither
 * knows nor cares which it was given.
 */
export type BackendPoll = { done: false } | { done: true; uri: string; cost?: number } | { done: true; error: string };

export interface VideoBackend {
  id: "nanogpt" | "gemini";
  model: string;
  /** Begin a job; `handle` is whatever `poll` needs to ask about it. `cost` is what the provider says it charged, in dollars, if it says. */
  start(r: VideoRequest, prompt: string, signal: AbortSignal): Promise<{ handle: string; cost?: number; /** The length actually asked for, when the model changed it to one it takes. */ seconds?: number }>;
  poll(handle: string, signal: AbortSignal): Promise<BackendPoll>;
  download(uri: string, signal: AbortSignal): Promise<Buffer>;
}
