import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { backupDir } from "@/lib/backup";
import { AUTO_NAME } from "@/lib/backup/auto";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/backup/auto/<name> — one automatic backup, as the zip it is. */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  // Only a name of exactly our shape: never a path, never anything else in the folder.
  if (!AUTO_NAME.test(name)) return Response.json({ error: "No such backup." }, { status: 404 });

  const file = path.join(backupDir(), name);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return Response.json({ error: "No such backup." }, { status: 404 });

  audit("backup.auto.download", name);
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
