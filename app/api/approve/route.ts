import { NextRequest } from "next/server";
import { grantWritesForRun, pendingSummary, settleApproval } from "@/lib/tools/fs/approval";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve a pending write or command approval. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  const decision = body?.decision === "approve" ? "approve" : "deny";
  /**
   * "Allow writes for this run" — approves this card AND stops asking for
   * later writes in the same turn. Anything other than an explicit true is
   * treated as a plain approval, so a malformed body can never widen the
   * decision beyond the single action in front of the user.
   */
  const forRun = decision === "approve" && body?.scope === "run";

  if (!id) return Response.json({ error: "No approval id." }, { status: 400 });

  const what = pendingSummary(id);
  const settled = settleApproval(id, decision);
  if (!settled) {
    return Response.json(
      { error: "That approval is no longer pending — it may have timed out." },
      { status: 409 },
    );
  }

  if (what) {
    audit(
      decision === "approve" ? "approval.approve" : "approval.deny",
      `${what.kind}: ${what.summary}${forRun ? " (and the rest of this run)" : ""}`,
    );
  }

  // Granted only after this card is settled, so a 409 on a timed-out approval
  // cannot leave a standing grant behind for a run that already gave up.
  if (forRun) grantWritesForRun();

  return Response.json({ ok: true, decision, scope: forRun ? "run" : "once" });
}
