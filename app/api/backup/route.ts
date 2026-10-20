import { backupEntries, backupFilename } from "@/lib/backup";
import { zipStream } from "@/lib/backup/zip";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/backup — every chat, memory, picture and schedule, as one zip. */
export async function GET() {
  audit("backup.download");
  return new Response(zipStream(backupEntries()), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${backupFilename()}"`,
      "Cache-Control": "no-store",
    },
  });
}
