import { NextRequest } from "next/server";
import { deleteVideo, isVideoId, parseRange, readVideoRange, statVideo } from "@/lib/videos/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/videos/:id — the video, with Range support so the player can seek
 * without downloading all of it. Ids are random and a video never changes, so
 * it may be cached; `private` keeps a shared proxy from keeping what sits
 * behind the login. `?download=1` asks for a save dialog.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isVideoId(id)) return Response.json({ error: "Invalid video id" }, { status: 400 });
  const found = await statVideo(id);
  if (!found) return Response.json({ error: "Video not found" }, { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (req.nextUrl.searchParams.get("download")) headers["Content-Disposition"] = `attachment; filename="jarvis-${id.slice(0, 8)}.mp4"`;

  const range = parseRange(req.headers.get("range"), found.size);
  if (range === "bad") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${found.size}` } });
  const [start, end, status] = range ? [range.start, range.end, 206] : [0, found.size - 1, 200];
  const bytes = await readVideoRange(id, start, end);
  headers["Content-Length"] = String(bytes.length);
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${found.size}`;
  return new Response(new Uint8Array(bytes), { status, headers });
}

/** DELETE /api/videos/:id — from the library. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isVideoId(id)) return Response.json({ error: "Invalid video id" }, { status: 400 });
  return (await deleteVideo(id)) ? Response.json({ ok: true }) : Response.json({ error: "Video not found" }, { status: 404 });
}
