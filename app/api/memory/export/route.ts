import { getMemory } from "@/lib/memory";
import { exportFilename, exportMemory } from "@/lib/memory/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — everything remembered, as a file you can keep or take to another install. */
export async function GET() {
  try {
    const now = new Date();
    const file = exportMemory(await getMemory().list(), now);
    return new Response(JSON.stringify(file, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(now)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
