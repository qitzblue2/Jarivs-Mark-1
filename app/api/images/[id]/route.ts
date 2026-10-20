import { NextRequest } from "next/server";
import { deleteImage, isImageId, readImage } from "@/lib/images/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const badId = () => Response.json({ error: "Invalid image id" }, { status: 400 });

/**
 * GET /api/images/:id — the picture itself.
 *
 * Ids are random and a picture never changes once written, so the browser may
 * keep it forever; `private` stops a shared proxy doing the same with
 * something that sits behind the login. `?download=1` asks for a save dialog.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isImageId(id)) return badId();

  const found = await readImage(id);
  if (!found) return Response.json({ error: "Image not found" }, { status: 404 });

  const ext = found.meta.mime.split("/")[1] === "jpeg" ? "jpg" : found.meta.mime.split("/")[1];
  const headers: Record<string, string> = {
    "Content-Type": found.meta.mime,
    "Content-Length": String(found.bytes.length),
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (req.nextUrl.searchParams.get("download")) {
    headers["Content-Disposition"] = `attachment; filename="jarvis-${id.slice(0, 8)}.${ext}"`;
  }

  return new Response(new Uint8Array(found.bytes), { headers });
}

/** DELETE /api/images/:id — from the gallery. Chats that showed it get a broken image, which is honest. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isImageId(id)) return badId();
  const removed = await deleteImage(id);
  if (!removed) return Response.json({ error: "Image not found" }, { status: 404 });
  return Response.json({ ok: true });
}
