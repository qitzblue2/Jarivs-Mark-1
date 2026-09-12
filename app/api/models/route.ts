import { NextRequest } from "next/server";
import { listModels } from "@/lib/providers/openai-compat";
import { PROVIDERS, PROVIDER_IDS, defaultProviderId, hasServerKey, resolveKey } from "@/lib/providers/registry";
import { ProviderError } from "@/lib/providers/types";
import { storageDriver } from "@/lib/storage";
import { computerAccessEnabled } from "@/lib/tools/fs/workspace";
import { authConfigured, openNetwork, requiresAuth } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live model lists, fetched from each provider on request.
 *
 * Model IDs are deliberately never hardcoded — Groq deprecated its Llama 3.x
 * IDs in June 2026 and a baked-in list would have silently broken the app.
 *
 * Client keys arrive via the `x-jarvis-keys` header (JSON, provider id → key)
 * rather than the query string, so they stay out of server access logs.
 */
export async function GET(req: NextRequest) {
  let clientKeys: Record<string, string> = {};
  const header = req.headers.get("x-jarvis-keys");
  if (header) {
    try {
      const parsed = JSON.parse(header);
      if (parsed && typeof parsed === "object") clientKeys = parsed;
    } catch {
      /* ignore a malformed header rather than failing the whole request */
    }
  }

  const providers = await Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const config = PROVIDERS[id];
      const key = resolveKey(id, clientKeys[id]);

      const base = {
        id,
        label: config.label,
        note: config.note,
        signupUrl: config.signupUrl,
        envKey: config.envKey,
        maxContextTokens: config.maxContextTokens,
        hasKey: Boolean(key),
        keySource: hasServerKey(id) ? "server" : key ? "client" : null,
        models: [] as string[],
        error: null as string | null,
      };

      if (!key) return base;

      try {
        const models = await listModels(id, key);
        return { ...base, models: models.map((m) => m.id) };
      } catch (err) {
        const message = err instanceof ProviderError ? err.message : (err as Error).message;
        return { ...base, error: message };
      }
    }),
  );

  const local = !requiresAuth(req.headers.get("host"));

  return Response.json(
    {
      providers,
      defaultProvider: defaultProviderId(),
      storage: storageDriver(),
      security: {
        computerAccess: computerAccessEnabled(),
        authConfigured: authConfigured(),
        local,
        openNetwork: openNetwork(),
        // Filesystem + shell reachable from off-machine is the one
        // combination worth shouting about.
        exposedWithComputerAccess: !local && computerAccessEnabled(),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
