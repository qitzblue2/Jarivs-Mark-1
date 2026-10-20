import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { isValidChatId } from "@/lib/types";
import { applyChatPatch } from "@/lib/chat-ops";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const badId = () => Response.json({ error: "Invalid chat id" }, { status: 400 });

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!isValidChatId(id)) return badId();
    const chat = await getStore().get(id);
    if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
    return Response.json({ chat });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * PATCH /api/chats/:id — rename, retarget the model, replace the messages, or
 * tidy: pin, tag, archive, set per-chat instructions. The client owns message
 * state while streaming and writes the whole array once a turn settles; that
 * keeps the store dumb. What counts as activity is decided in applyChatPatch.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!isValidChatId(id)) return badId();
    const store = getStore();
    const existing = await store.get(id);
    if (!existing) return Response.json({ error: "Chat not found" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const result = applyChatPatch(existing, body);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

    await store.save(result.chat);
    return Response.json({ chat: result.chat });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/chats/:id — move to the trash. Recoverable for 30 days from
 * /api/trash; nothing here destroys a chat.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!isValidChatId(id)) return badId();
    const store = getStore();
    const title = (await store.get(id))?.title;
    const moved = await store.trash(id);
    if (moved) audit("chat.trash", title);
    return Response.json({ ok: true, trashed: moved });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
