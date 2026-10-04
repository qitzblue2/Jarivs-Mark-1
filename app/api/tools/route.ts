import { allTools } from "@/lib/tools/registry";
import { toWireTool } from "@/lib/tools/types";
import { estimateTokens } from "@/lib/tokens";
import { resolveImageKey } from "@/lib/tools/generate-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tools — the tools this JARVIS can offer right now, for the Settings
 * list that switches them off. "Right now" matters: the display and schedule tools
 * appear only where an announcement can land, pictures only with a key, and the
 * computer and self-editing tools only when their environment gates are set, so
 * the list is exactly what a request would carry — not a catalogue of what might exist.
 */
export async function GET(req: Request) {
  const key = req.headers.get("x-jarvis-nanogpt-key") ?? undefined;
  const tools = allTools({ imageKey: resolveImageKey(key) });
  return Response.json(
    {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description.replace(/\s+/g, " ").trim().slice(0, 400),
        tokens: estimateTokens(JSON.stringify(toWireTool(t))),
        dangerous: Boolean(t.dangerous),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
