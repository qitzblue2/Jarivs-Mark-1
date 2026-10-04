import { NextRequest } from "next/server";
import { largestChats, measureData } from "@/lib/storage-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/storage — what takes the room in the data folder, and the biggest chats. `?largest=N` sets how many. */
export async function GET(req: NextRequest) {
  try {
    const n = Number(req.nextUrl.searchParams.get("largest") ?? 10);
    const [usage, big] = await Promise.all([measureData(), largestChats(Number.isFinite(n) ? n : 10)]);
    return Response.json({ ...usage, largest: big }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
