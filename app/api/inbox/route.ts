import { NextRequest } from "next/server";
import { clearInbox, listInbox, markRead } from "@/lib/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/inbox — what JARVIS said while you were away, newest first.
 * `?since=<ms>` returns only what arrived after that moment.
 */
export async function GET(req: NextRequest) {
  try {
    const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
    const all = await listInbox();
    return Response.json(
      {
        items: Number.isFinite(since) && since > 0 ? all.filter((i) => i.at > since) : all,
        unread: all.filter((i) => !i.read).length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/inbox — mark read or clear. There is no action that adds an item:
 * only the server's own work (a scheduled task finishing, a backup failing)
 * does, so nothing in a browser can make JARVIS say something.
 */
export async function POST(req: NextRequest) {
  // application/json only: a page on another site can send this cross-origin
  // only after a preflight that is never approved — the same guard as the
  // other write routes.
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Expected application/json." }, { status: 415 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === "string").slice(0, 200) : undefined;

  try {
    if (body.action === "read") return Response.json({ changed: await markRead(ids) });
    if (body.action === "clear") return Response.json({ removed: await clearInbox(ids) });
    return Response.json({ error: 'action must be "read" or "clear".' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
