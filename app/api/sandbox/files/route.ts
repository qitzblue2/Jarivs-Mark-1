import { isEditable, sandboxRoot, selfEditEnabled } from "@/lib/sandbox/paths";
import { ensureSandbox, listSourceFiles } from "@/lib/sandbox/sync";
import { disabled } from "../state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sandbox/files — every source file in the sandbox, for the file tree. */
export async function GET() {
  if (!selfEditEnabled()) return disabled();
  await ensureSandbox();
  const files = (await listSourceFiles(sandboxRoot())).map((path) => ({ path, editable: isEditable(path) }));
  return Response.json({ files });
}
