import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { newId, type Chat } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/chats — sidebar rows, newest first. */
export async function GET() {
  try {
    return Response.json({ chats: await getStore().list() });
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
