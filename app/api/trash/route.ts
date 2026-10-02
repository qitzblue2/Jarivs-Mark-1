import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { isValidChatId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/trash — deleted chats, newest first, after dropping any past their 30 days. */
export async function GET() {
  try {
    const store = getStore();
    await store.purgeExpired();
    const items = await store.listTrash();
    return Response.json({
      chats: items.map((c) => ({
        id: c.id,
        title: c.title,
        deletedAt: c.deletedAt,
        messageCount: c.messages.length,
      })),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** POST /api/trash  { id } — put a chat back. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "");
    if (!isValidChatId(id)) return Response.json({ error: "Invalid chat id" }, { status: 400 });
    const restored = await getStore().restore(id);
    if (!restored) return Response.json({ error: "That chat isn't in the trash." }, { status: 404 });
    audit("chat.restore", id.slice(0, 8));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/trash?id=…  — destroy one trashed chat.
 * DELETE /api/trash?all=1 — empty the trash.
 * The only places a chat is ever destroyed on purpose.
 */
export async function DELETE(req: NextRequest) {
  try {
    const store = getStore();
    if (req.nextUrl.searchParams.get("all") === "1") {
      let removed = 0;
      for (const item of await store.listTrash()) if (await store.purge(item.id)) removed++;
      return Response.json({ ok: true, removed });
    }
    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!isValidChatId(id)) return Response.json({ error: "Invalid chat id" }, { status: 400 });
    const gone = await store.purge(id);
    return gone ? Response.json({ ok: true }) : Response.json({ error: "That chat isn't in the trash." }, { status: 404 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
