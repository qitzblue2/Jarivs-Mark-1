import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { isValidChatId, type Chat, type Message } from "@/lib/types";

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
 * PATCH /api/chats/:id — update the title, the model selection, or replace the
 * message list. The client owns message state while streaming and writes the
 * whole array once a turn settles; that keeps the store dumb.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!isValidChatId(id)) return badId();
    const store = getStore();
    const existing = await store.get(id);
    if (!existing) return Response.json({ error: "Chat not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));

    const updated: Chat = {
      ...existing,
      title: typeof body?.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 200)
        : existing.title,
      messages: Array.isArray(body?.messages) ? (body.messages as Message[]) : existing.messages,
      provider: typeof body?.provider === "string" ? body.provider : existing.provider,
      model: typeof body?.model === "string" ? body.model : existing.model,
      updatedAt: Date.now(),
    };

    await store.save(updated);
    return Response.json({ chat: updated });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!isValidChatId(id)) return badId();
    await getStore().delete(id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
