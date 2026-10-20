import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { importChat, MAX_IMPORT_BYTES } from "@/lib/chat-import";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chats/import — add a chat from a JARVIS export (`?format=json`).
 *
 * Always a new chat with a new id: importing can't replace or merge into one
 * you already have. The file is checked field by field (lib/chat-import.ts), so
 * a hand-edited or hostile file can add a conversation and nothing else.
 */
export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Expected application/json." }, { status: 415 });
  }
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES) return Response.json({ error: "That file is too large to import." }, { status: 413 });

  try {
    const text = await req.text();
    if (text.length > MAX_IMPORT_BYTES) return Response.json({ error: "That file is too large to import." }, { status: 413 });
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return Response.json({ error: "That file isn't valid JSON." }, { status: 400 });
    }
    const result = importChat(raw);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    await getStore().save(result.chat);
    audit("chat.import", result.chat.title);
    return Response.json({ chat: { id: result.chat.id, title: result.chat.title, messages: result.chat.messages.length }, skipped: result.skipped }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
