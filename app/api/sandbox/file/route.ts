import { NextRequest } from "next/server";
import { unifiedDiff } from "@/lib/sandbox/diff";
import { isEditable, resolveSource, sandboxRoot, selfEditEnabled } from "@/lib/sandbox/paths";
import { deleteSandboxFile, ensureSandbox, readBoth, writeSandboxFile } from "@/lib/sandbox/sync";
import { disabled } from "../state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (err: unknown) => Response.json({ error: (err as Error).message }, { status: 400 });

/** GET /api/sandbox/file?path= — a file as the sandbox and JARVIS each have it, and the diff. */
export async function GET(req: NextRequest) {
  if (!selfEditEnabled()) return disabled();
  try {
    await ensureSandbox();
    const { rel } = await resolveSource(req.nextUrl.searchParams.get("path") ?? "", sandboxRoot());
    const { sandbox, live } = await readBoth(rel);
    if (sandbox === null && live === null) return Response.json({ error: "No such file." }, { status: 404 });
    return Response.json({
      path: rel,
      sandbox,
      live,
      editable: isEditable(rel),
      diff: sandbox !== live ? unifiedDiff(live ?? "", sandbox ?? "", rel) : "",
    });
  } catch (err) {
    return bad(err);
  }
}

/**
 * PUT /api/sandbox/file — save a file you edited in the panel.
 *
 * No approval card: this is you typing, not the model. It still only ever
 * reaches the sandbox, and still only within the source folders.
 */
export async function PUT(req: NextRequest) {
  if (!selfEditEnabled()) return disabled();
  try {
    const body = await req.json();
    if (typeof body?.content !== "string") throw new Error("No content given.");
    const result = await writeSandboxFile(String(body.path ?? ""), body.content);
    return Response.json(result);
  } catch (err) {
    return bad(err);
  }
}

/** DELETE /api/sandbox/file?path= — remove a file from the sandbox. */
export async function DELETE(req: NextRequest) {
  if (!selfEditEnabled()) return disabled();
  try {
    const rel = await deleteSandboxFile(req.nextUrl.searchParams.get("path") ?? "");
    return Response.json({ deleted: rel });
  } catch (err) {
    return bad(err);
  }
}
