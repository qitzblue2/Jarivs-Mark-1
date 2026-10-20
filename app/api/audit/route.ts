import { NextRequest } from "next/server";
import { recentAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/audit?limit= — the most recent entries, newest first. */
export async function GET(req: NextRequest) {
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 100));
  return Response.json({ entries: await recentAudit(limit) });
}
