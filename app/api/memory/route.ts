import { NextRequest } from "next/server";
import { getMemory } from "@/lib/memory";
import { isValidChatId, newId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — everything JARVIS remembers, newest first. */
export async function GET() {
  try {
    const entries = await getMemory().list();
    return Response.json({ entries: entries.sort((a, b) => b.updatedAt - a.updatedAt) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** POST — add or edit an entry by hand. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = String(body?.text ?? "").trim();
    if (!text) return Response.json({ error: "Text is required." }, { status: 400 });

    const store = getMemory();
    const now = Date.now();
    const tags = Array.isArray(body?.tags)
      ? body.tags.map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean)
      : [];

    if (body?.id) {
      const existing = (await store.list()).find((e) => e.id === body.id);
      if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
      await store.save({ ...existing, text, tags, updatedAt: now });
      return Response.json({ ok: true });
    }

    await store.save({ id: newId(), text, tags, createdAt: now, updatedAt: now });
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** DELETE — one entry by id, or everything with ?all=1. */
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("all") === "1") {
      await getMemory().clear();
      return Response.json({ ok: true });
    }

    const id = url.searchParams.get("id") ?? "";
    if (!isValidChatId(id)) return Response.json({ error: "Invalid id" }, { status: 400 });

    await getMemory().delete(id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
