import { NextRequest } from "next/server";
import { backupDir } from "@/lib/backup";
import { autoBackupEnabled, backupsKept, includesImages, listAutoBackups, runAutoBackup } from "@/lib/backup/auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function status() {
  return {
    enabled: autoBackupEnabled(),
    keep: backupsKept(),
    includesImages: includesImages(),
    folder: backupDir(),
    backups: await listAutoBackups(),
  };
}

/** GET /api/backup/auto — are daily backups on, and what is there. */
export async function GET() {
  return Response.json(await status(), { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/backup/auto — make a backup now (replacing today's), and trim to the limit. */
export async function POST(req: NextRequest) {
  // application/json only, like the other write routes: a page on another site
  // can't send this cross-origin without a preflight that is never approved.
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Expected application/json." }, { status: 415 });
  }
  const result = await runAutoBackup(new Date(), true);
  if (result.error) return Response.json({ error: `The backup failed: ${result.error}`, ...(await status()) }, { status: 500 });
  return Response.json({ ...result, ...(await status()) });
}
