import { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { imageUrl, saveImage } from "@/lib/images/store";
import { cleanImageRequest, seedsFor, styledPrompt } from "@/lib/images/styles";
import { FREE_MODEL, FREE_USAGE_ID, freeImage, freeImagesEnabled } from "@/lib/images/free";
import { imageModel, nanoImage, resolveImageKey } from "@/lib/tools/generate-image";
import { recordRequest } from "@/lib/providers/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Four pictures from a slow free service can take a few minutes.
export const maxDuration = 300;

function clientNanoKey(req: NextRequest): string | undefined {
  try {
    const parsed = JSON.parse(req.headers.get("x-jarvis-keys") || "{}");
    return typeof parsed?.nanogpt === "string" ? parsed.nanogpt : undefined;
  } catch {
    return undefined;
  }
}

/** Which service would draw right now: your NanoGPT key first, then the free one. */
function provider(key: string | undefined): { id: "nanogpt" | "free" | "none"; model: string } {
  if (key) return { id: "nanogpt", model: imageModel() };
  if (freeImagesEnabled()) return { id: "free", model: FREE_MODEL };
  return { id: "none", model: "" };
}

/** GET /api/images/generate — what would make a picture, so the page can say so before you ask. */
export async function GET(req: NextRequest) {
  const p = provider(resolveImageKey(clientNanoKey(req)));
  return Response.json({
    provider: p.id,
    model: p.model,
    note:
      p.id === "free"
        ? "Free and keyless. Your prompt goes to the Pollinations image service."
        : p.id === "nanogpt"
          ? "Using your NanoGPT key."
          : "No picture service is set up. Add a NanoGPT key, or remove JARVIS_FREE_IMAGES=0.",
  });
}

/**
 * POST /api/images/generate — draw on request, without going through the chat
 * model: you pressed the button, so the picture is made and saved. One to four
 * pictures per call, one after another; a failure part-way keeps the ones
 * already made.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = cleanImageRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const r = parsed.request;

  const key = resolveImageKey(clientNanoKey(req));
  const p = provider(key);
  if (p.id === "none") return Response.json({ error: "No picture service is set up." }, { status: 503 });

  const text = styledPrompt(r.prompt, r.style, r.avoid);
  const seeds = seedsFor(r.count, r.seed);
  const made: { id: string; url: string; seed: number }[] = [];
  let error: string | undefined;

  for (const seed of seeds) {
    try {
      let bytes: Buffer;
      if (p.id === "nanogpt") {
        ({ bytes } = await nanoImage({ apiKey: key!, prompt: text, model: p.model, shape: r.shape, signal: req.signal }));
      } else {
        bytes = await freeImage({ prompt: text, shape: r.shape, seed, signal: req.signal });
        recordRequest(FREE_USAGE_ID, 0, 200);
      }
      const meta = await saveImage(bytes, { prompt: r.prompt, model: p.model, style: r.style, seed });
      made.push({ id: meta.id, url: imageUrl(meta.id), seed });
    } catch (err) {
      if (p.id === "free") recordRequest(FREE_USAGE_ID, 0, 500);
      error = (err as Error).message;
      break;
    }
  }

  if (made.length > 0) audit("image.make", `${made.length} via ${p.id}`);
  if (made.length === 0) return Response.json({ error: error ?? "No picture was made." }, { status: 502 });
  return Response.json({ images: made, provider: p.id, model: p.model, ...(error ? { warning: error } : {}) });
}
