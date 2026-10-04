import { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { describeRestore, restoreBackup } from "@/lib/backup/restore";
import { ZipError } from "@/lib/backup/unzip";
import { imageDir } from "@/lib/images/store";
import { getMemory } from "@/lib/memory";
import { getStore } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD = 300 * 1024 * 1024;

/**
 * POST /api/backup/restore — the body is the zip itself (application/zip).
 *
 * Requiring that content type is the guard against another website making
 * your browser post here: a cross-site request can't send it without a
 * preflight this server never approves. Restoring only ever adds what's
 * missing; see lib/backup/restore.ts.
 */
export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("application/zip")) {
    return Response.json({ error: "Send the backup as application/zip." }, { status: 415 });
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD) return Response.json({ error: "That file is too large to be a JARVIS backup." }, { status: 413 });

  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_UPLOAD) return Response.json({ error: "That file is too large to be a JARVIS backup." }, { status: 413 });

    const report = await restoreBackup(bytes, { chats: getStore(), memory: getMemory(), imagesDir: imageDir() });
    const summary = describeRestore(report);
    audit("backup.restore", summary);
    return Response.json({ report, summary });
  } catch (err) {
    if (err instanceof ZipError) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
