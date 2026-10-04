import { NextRequest } from "next/server";
import { getMemory } from "@/lib/memory";
import { cleanTags } from "@/lib/memory/filter";
import { cleanExpiry, parseBulk } from "@/lib/memory/housekeeping";
import { MAX_MEMORY_ENTRIES } from "@/lib/memory/transfer";
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

/**
 * POST — add or edit an entry by hand.
 *
 * `{ bulk: "line\nline #tag" }` adds one entry per line (see parseBulk), skipping
 * what is already remembered, and says how many went in and why the rest didn't.
 * `expires` is a time, or null to make an entry last again.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    if (typeof body?.bulk === "string") {
      const store = getMemory();
      const existing = await store.list();
      const plan = parseBulk(body.bulk, existing.map((e) => e.text));
      const room = Math.max(0, MAX_MEMORY_ENTRIES - existing.length);
      const adding = plan.add.slice(0, room);
      const now = Date.now();
      await store.addMany(adding.map((a, i) => ({ id: newId(), text: a.text, tags: a.tags, createdAt: now + i, updatedAt: now + i })));
      return Response.json({ added: adding.length, skipped: { ...plan.skipped, full: plan.add.length - adding.length } }, { status: 201 });
    }

    const text = String(body?.text ?? "").trim();
    if (!text) return Response.json({ error: "Text is required." }, { status: 400 });

    const store = getMemory();
    const now = Date.now();
    // Tags are only replaced when the request carries some. An edit that sends
    // just new text used to wipe them — including "always", which is what keeps
    // an entry in every chat.
    const sentTags = Array.isArray(body?.tags);
    const tags = cleanTags(body?.tags);
    const expires = cleanExpiry(body?.expires);

    if (body?.id) {
      const existing = (await store.list()).find((e) => e.id === body.id);
      if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
      const next = { ...existing, text, tags: sentTags ? tags : existing.tags, updatedAt: now };
      // Only touched when the request says something about it: an edit of the words must not make a fact last forever.
      if (expires === null) delete next.expires;
      else if (expires !== undefined) next.expires = expires;
      await store.save(next);
      return Response.json({ ok: true });
    }

    // A card that offers to remember something sets `dedupe`: pressing it twice,
    // or in two tabs, should leave one note, not two. Manual adds are untouched.
    if (body?.dedupe === true) {
      const same = (await store.list()).find((e) => e.text.trim().toLowerCase() === text.toLowerCase());
      if (same) {
        // Already known — but "always keep in mind" on a note that is not pinned yet pins it.
        if (tags.includes("always") && !same.tags.includes("always")) {
          await store.save({ ...same, tags: [...same.tags, "always"], updatedAt: now });
        }
        return Response.json({ ok: true, duplicate: true });
      }
    }

    await store.save({ id: newId(), text, tags, createdAt: now, updatedAt: now, ...(typeof expires === "number" ? { expires } : {}) });
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
