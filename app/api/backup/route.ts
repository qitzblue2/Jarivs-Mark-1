import { backupEntries, backupFilename } from "@/lib/backup";
import { zipStream } from "@/lib/backup/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/backup — every chat, memory, picture and schedule, as one zip. */
export async function GET() {
  return new Response(zipStream(backupEntries()), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${backupFilename()}"`,
      "Cache-Control": "no-store",
    },
  });
}
