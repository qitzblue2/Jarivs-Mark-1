import { getStore } from "@/lib/storage";
import { zipStream, type ZipEntry } from "@/lib/backup/zip";
import { chatToMarkdown } from "@/lib/chat-search";
import { markdownArchiveName, markdownEntryName } from "@/lib/chat-archive";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/export/markdown — every chat as its own .md file in one zip, named by
 * date and title. For reading in any editor or moving to another tool; the
 * backup zip is the one for restoring JARVIS itself.
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const store = getStore();
  const metas = await store.list();

  async function* entries(): AsyncGenerator<ZipEntry> {
    const used = new Set<string>();
    const encoder = new TextEncoder();
    for (const meta of metas) {
      const chat = await store.get(meta.id);
      if (!chat || chat.messages.length === 0) continue;
      const name = markdownEntryName(chat, used);
      yield { name, data: encoder.encode(chatToMarkdown(chat, origin)), mtime: new Date(chat.updatedAt) };
    }
  }

  audit("export.markdown", `${metas.length} chats`);
  return new Response(zipStream(entries()), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${markdownArchiveName()}"`,
      "Cache-Control": "no-store",
    },
  });
}
