import { NextRequest } from "next/server";
import { settleApproval } from "@/lib/tools/fs/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve a pending write or command approval. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  const decision = body?.decision === "approve" ? "approve" : "deny";

  if (!id) return Response.json({ error: "No approval id." }, { status: 400 });

  const settled = settleApproval(id, decision);
  if (!settled) {
    return Response.json(
      { error: "That approval is no longer pending — it may have timed out." },
      { status: 409 },
    );
  }

  return Response.json({ ok: true, decision });
}
