import { getStore } from "@/lib/storage";
import { listStarred } from "@/lib/starred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/starred — every starred message across every chat, newest first.
 * Reads each chat in full, which is fine for a personal install and avoids
 * keeping a second index of your conversations in step with the first.
 */
export async function GET() {
  try {
    const store = getStore();
    const metas = await store.list();
    const chats = (await Promise.all(metas.map((m) => store.get(m.id)))).filter((c) => c !== null);
    return Response.json({ items: listStarred(chats) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
