import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { newId, type Chat } from "@/lib/types";
import { searchChats, sortChats } from "@/lib/chat-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chats — sidebar rows, pinned first, then newest.
 * GET /api/chats?q=words — chats containing every word anywhere in them.
 *
 * Search reads every chat in full. For a personal install that is a few
 * hundred small JSON files, which is fast enough that an index would be a
 * second copy of your conversations to keep in sync for nothing.
 */
export async function GET(req: NextRequest) {
  try {
    const store = getStore();
    const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 200);
    if (q) {
      const metas = await store.list();
      const chats = (await Promise.all(metas.map((m) => store.get(m.id)))).filter((c) => c !== null);
      return Response.json({ chats: searchChats(chats, q) });
    }
    return Response.json({ chats: sortChats(await store.list()) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** POST /api/chats — create an empty chat. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const now = Date.now();

    const chat: Chat = {
      id: newId(),
      title: typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "New chat",
      createdAt: now,
      updatedAt: now,
      messages: [],
      provider: typeof body?.provider === "string" ? body.provider : undefined,
      model: typeof body?.model === "string" ? body.model : undefined,
    };

    await getStore().save(chat);
    return Response.json({ chat }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
