import { PROVIDERS } from "@/lib/providers/registry";
import { cooldownRemaining } from "@/lib/providers/quota";
import { usageHistory } from "@/lib/providers/usage";
import { IMAGE_USAGE_ID } from "@/lib/tools/generate-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/usage — JARVIS' own count of what it has sent each provider, per
 * UTC day, plus which providers are sitting out a rate limit right now.
 */
export async function GET() {
  try {
    const days = await usageHistory();
    const ids = new Set(days.flatMap((d) => Object.keys(d.providers)));

    const labels: Record<string, string> = { [IMAGE_USAGE_ID]: "NanoGPT pictures" };
    const cooling: Record<string, number> = {};
    for (const id of ids) {
      if (PROVIDERS[id]) labels[id] = PROVIDERS[id].label;
      const left = PROVIDERS[id] ? cooldownRemaining(id) : 0;
      if (left > 0) cooling[id] = left;
    }

    return Response.json({ days, labels, cooling });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
