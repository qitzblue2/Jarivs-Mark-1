import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { runningJob, startJob } from "@/lib/videos/jobs";
import { getCatalog } from "@/lib/videos/catalog";
import { chooseBackend, describeVideo, pickProvider, resolveNanoKey, resolveVideoKey, type Keys } from "@/lib/videos/provider";
import { cleanVideoRequest, composeVideoPrompt, underLimit } from "@/lib/videos/request";
import { listVideos } from "@/lib/videos/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keys from the server's environment, or the ones Settings sends in a header. */
function keysFrom(req: NextRequest): Keys {
  let client: Record<string, unknown> = {};
  try {
    client = JSON.parse(req.headers.get("x-jarvis-keys") || "{}") ?? {};
  } catch {
    // Not JSON: no client keys.
  }
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  return { nanogpt: resolveNanoKey(text(client.nanogpt)), gemini: resolveVideoKey(text(client.gemini)) };
}

function noteFor(provider: string | null): string {
  if (provider === "nanogpt") return "Made through NanoGPT and billed to your NanoGPT account.";
  if (provider === "gemini") return "Made by Google's Veo through your Gemini key — a paid model that bills your Google account.";
  return "Needs a NanoGPT key (recommended) or a Gemini key with access to Veo — in .env.local or Settings → API keys. Video is a paid feature on both.";
}

/** GET /api/videos/generate — whether video can be made, by whom, with which models, and how many are left today. */
export async function GET(req: NextRequest) {
  const keys = keysFrom(req);
  const catalog = pickProvider(keys) === "nanogpt" ? await getCatalog(keys.nanogpt!) : null;
  const info = describeVideo(keys, catalog?.models ?? []);
  const limit = underLimit((await listVideos()).map((v) => v.createdAt));
  return Response.json({
    ...info,
    catalog: catalog ? { source: catalog.source, subscriptionListing: catalog.subscriptionListing } : null,
    used: limit.used,
    limit: limit.limit,
    running: runningJob()?.id ?? null,
    note: noteFor(info.provider),
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

  const keys = keysFrom(req);
  if (!pickProvider(keys)) return Response.json({ error: "No NanoGPT or Gemini key is set up, so there is nothing to make video with." }, { status: 503 });
  const catalog = pickProvider(keys) === "nanogpt" ? await getCatalog(keys.nanogpt!) : null;
  const chosen = chooseBackend(keys, parsed.request.model || undefined, catalog?.models ?? []);
  if (!chosen) return Response.json({ error: `NanoGPT doesn't offer a video model called “${parsed.request.model}”. Pick one from the list.` }, { status: 400 });

  const running = runningJob();
  if (running) return Response.json({ error: "A video is already being made. Wait for it, or stop it.", job: running }, { status: 429 });

  const limit = underLimit((await listVideos()).map((v) => v.createdAt));
  if (!limit.ok) {
    return Response.json({ error: `That is today's limit (${limit.limit}). Raise JARVIS_VIDEO_DAILY_LIMIT if you want more — each video is billed by your provider.` }, { status: 429 });
  }

  const sound = chosen.sound !== "no";
  const job = startJob({ id: randomUUID(), backend: chosen.backend, request: parsed.request, sound });
  return Response.json({ job, prompt: composeVideoPrompt(parsed.request, sound), silent: !sound }, { status: 202 });
}
