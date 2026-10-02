import { NextRequest } from "next/server";
import { getMemory } from "@/lib/memory";
import { planImport } from "@/lib/memory/transfer";
import { newId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A memory file is text; two megabytes is far more than 2,000 short entries need. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * POST — add the entries from a memory file. Additive only: nothing already
 * remembered is changed or removed, duplicates are skipped, and the response
 * says what was added and what wasn't. `?dry=1` reports without writing.
 */
export async function POST(req: NextRequest) {
  // application/json only: a page on another site can send a cross-origin
  // request with this type only after a preflight we don't answer — the same
  // guard the other write routes use.
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Expected application/json." }, { status: 415 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return Response.json({ error: "That file is too large for a memory import." }, { status: 413 });
  }

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BYTES) return Response.json({ error: "That file is too large for a memory import." }, { status: 413 });
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "That isn't valid JSON." }, { status: 400 });
  }

  try {
    const store = getMemory();
    const plan = planImport(await store.list(), raw, newId);
    if (!plan.ok) return Response.json({ error: plan.error }, { status: 400 });

    const dry = new URL(req.url).searchParams.get("dry") === "1";
    if (!dry) await store.addMany(plan.add);
    return Response.json({ ok: true, dry, added: plan.add.length, skipped: plan.skipped, pinned: plan.pinned });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
