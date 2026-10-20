import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { isValidChatId } from "@/lib/types";
import { chatToMarkdown, exportFilename } from "@/lib/chat-search";
import { chatToHtml, htmlFilename } from "@/lib/chat-html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/chats/:id/export — the conversation as a download.
 * Markdown by default, for reading; `?format=json` for the complete chat as
 * stored, for keeping or moving; `?format=html` for one self-contained page to
 * send to someone without JARVIS. None includes image bytes, which were never
 * saved with the chat.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isValidChatId(id)) return Response.json({ error: "Invalid chat id" }, { status: 400 });

  const chat = await getStore().get(id);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });

  if (req.nextUrl.searchParams.get("format") === "json") {
    return new Response(JSON.stringify({ format: "jarvis-chat", version: 1, chat }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(chat).replace(/\.md$/, ".json")}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (req.nextUrl.searchParams.get("format") === "html") {
    return new Response(chatToHtml(chat), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${htmlFilename(chat)}"`,
        "Cache-Control": "no-store",
        // The page has no scripts and needs none; if one were ever smuggled in it still could not run.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  }

  return new Response(chatToMarkdown(chat, req.nextUrl.origin), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(chat)}"`,
      "Cache-Control": "no-store",
    },
  });
}
