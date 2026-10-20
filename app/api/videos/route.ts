import { listVideos, videoUrl } from "@/lib/videos/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/videos — every video JARVIS has made, newest first. */
export async function GET() {
  try {
    return Response.json({ videos: (await listVideos()).map((v) => ({ ...v, url: videoUrl(v.id) })) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
