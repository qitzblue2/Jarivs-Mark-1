import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { startJob, runningJob } from "@/lib/videos/jobs";
import { cleanVideoRequest, composeVideoPrompt, underLimit } from "@/lib/videos/request";
import { listVideos } from "@/lib/videos/store";
import { resolveVideoKey, videoModel } from "@/lib/videos/veo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientGeminiKey(req: NextRequest): string | undefined {
  try {
    const parsed = JSON.parse(req.headers.get("x-jarvis-keys") || "{}");
    return typeof parsed?.gemini === "string" ? parsed.gemini : undefined;
  } catch {
    return undefined;
  }
}

/** GET /api/videos/generate — whether video can be made, with what, and how many are left today. */
export async function GET(req: NextRequest) {
  const key = resolveVideoKey(clientGeminiKey(req));
  const limit = underLimit((await listVideos()).map((v) => v.createdAt));
  return Response.json({
    available: Boolean(key),
    model: videoModel(),
    used: limit.used,
    limit: limit.limit,
    running: runningJob()?.id ?? null,
    note: key
      ? "Made by Google's Veo through your Gemini key — a paid model that bills your Google account."
      : "Needs a Gemini key with access to Veo, in .env.local (GEMINI_API_KEY) or Settings → API keys. Veo is a paid model.",
  });
}

/**
 * POST /api/videos/generate — start a video. Returns a job to check on; the
 * studio polls it. Refuses when there is no key, when one is already being
 * made, or when today's limit (JARVIS_VIDEO_DAILY_LIMIT, default 5) is used.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = cleanVideoRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const key = resolveVideoKey(clientGeminiKey(req));
  if (!key) return Response.json({ error: "No Gemini key is set up, so there is nothing to make video with." }, { status: 503 });

  const running = runningJob();
  if (running) return Response.json({ error: "A video is already being made. Wait for it, or stop it.", job: running }, { status: 429 });

  const limit = underLimit((await listVideos()).map((v) => v.createdAt));
  if (!limit.ok) {
    return Response.json({ error: `That is today's limit (${limit.limit}). Raise JARVIS_VIDEO_DAILY_LIMIT if you want more — each video is billed by your provider.` }, { status: 429 });
  }

  const job = startJob({ id: randomUUID(), key, model: videoModel(), request: parsed.request });
  return Response.json({ job, prompt: composeVideoPrompt(parsed.request) }, { status: 202 });
}
