import { NextRequest } from "next/server";
import { getStore } from "@/lib/storage";
import { computeChatStats, MAX_DAYS } from "@/lib/chat-stats";
import type { Chat } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enough for any real history; past it the oldest are left out rather than the request slowing without bound. */
const MAX_CHATS = 3000;

/**
 * GET /api/stats — what the chats add up to. `tz` is the browser's
 * `getTimezoneOffset()`, so "per day" means the days on your clock rather than
 * the server's; `days` is how many to chart (up to 90).
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tz = Number(url.searchParams.get("tz") ?? 0);
    const days = Number(url.searchParams.get("days") ?? 30);

    const store = getStore();
    const metas = (await store.list()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
    const chats: Chat[] = [];
    // A few at a time: all of them at once would open every chat file together.
    for (let i = 0; i < metas.length; i += 25) {
      const batch = await Promise.all(metas.slice(i, i + 25).map((m) => store.get(m.id)));
      for (const chat of batch) if (chat) chats.push(chat);
    }

    return Response.json(
      computeChatStats(chats, {
        offsetMinutes: Number.isFinite(tz) ? Math.max(-840, Math.min(840, tz)) : 0,
        days: Number.isFinite(days) ? Math.min(MAX_DAYS, days) : 30,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
