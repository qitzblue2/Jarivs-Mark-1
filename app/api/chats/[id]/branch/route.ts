import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { branchChat } from "@/lib/chat-ops";
import { isValidChatId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/chats/:id/branch  { messageId? }
 *
 * With a messageId: a new chat holding the conversation up to that message,
 * to ask something different from there. Without: a copy of the whole chat.
 * The original is never touched.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!isValidChatId(id)) return Response.json({ error: "Invalid chat id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const messageId = typeof body?.messageId === "string" ? body.messageId : undefined;

    const store = getStore();
    const source = await store.get(id);
    if (!source) return Response.json({ error: "Chat not found" }, { status: 404 });

    const copy = branchChat(source, messageId);
    if (!copy) return Response.json({ error: "That message isn't in this chat." }, { status: 404 });

    await store.save(copy);
    return Response.json({ chat: copy }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
