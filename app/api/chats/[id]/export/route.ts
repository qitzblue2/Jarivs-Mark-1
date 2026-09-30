import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { isValidChatId } from "@/lib/types";
import { chatToMarkdown, exportFilename } from "@/lib/chat-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/chats/:id/export — the conversation as a Markdown file download. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isValidChatId(id)) return Response.json({ error: "Invalid chat id" }, { status: 400 });

  const chat = await getStore().get(id);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });

  return new Response(chatToMarkdown(chat, req.nextUrl.origin), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(chat)}"`,
      "Cache-Control": "no-store",
    },
  });
}
