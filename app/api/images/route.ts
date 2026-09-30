import { listImages, imageUrl } from "@/lib/images/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/images — every picture JARVIS has made, newest first, for the gallery. */
export async function GET() {
  try {
    const images = (await listImages()).map((meta) => ({ ...meta, url: imageUrl(meta.id) }));
    return Response.json({ images });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
