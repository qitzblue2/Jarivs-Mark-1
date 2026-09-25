import { NextRequest } from "next/server";
import { listModels } from "@/lib/providers/openai-compat";
import {
  PROVIDERS,
  PROVIDER_IDS,
  defaultProviderId,
  getProvider,
  hasServerKey,
  preferredModel,
  providerReady,
  requiresKey,
  resolveEndpoint,
  resolveKey,
} from "@/lib/providers/registry";
import { ProviderError } from "@/lib/providers/types";
import { cooldownRemaining, stats as quotaStats } from "@/lib/providers/quota";
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
 * rather than the query string, so they stay out of server access logs. The
 * self-hosted slot's URL arrives the same way.
 */
/** Ignore a malformed header rather than failing the whole request. */
function jsonHeader(req: NextRequest, name: string): Record<string, string> {
  const raw = req.headers.get(name);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const clientKeys = jsonHeader(req, "x-jarvis-keys");
  const clientEndpoints = jsonHeader(req, "x-jarvis-endpoints");
  // The Test button in Settings asks "is it reachable right now", which a
  // cached answer cannot give. Ordinary page loads must stay cached, or the
  // quota goes back to being spent on refreshes.
  const force = req.headers.get("x-jarvis-refresh") === "1";

  const providers = await Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const config = PROVIDERS[id];
      const endpoint = resolveEndpoint(id, clientEndpoints[id]);
      // Resolved WITHOUT the browser's own budget, so the sizes below are
      // what applies when the Settings boxes are left empty — which is
      // exactly what a placeholder should promise.
      const sizes = getProvider(id, clientEndpoints[id]);
      const key = resolveKey(id, clientKeys[id], endpoint.fromClient);
      const needsKey = requiresKey(id);

      const base = {
        id,
        label: config.label,
        note: config.note,
        signupUrl: config.signupUrl,
        envKey: config.envKey,
        maxContextTokens: sizes.maxContextTokens,
        /** Whether this provider is usable — not whether a key exists. */
        ready: providerReady(id, clientKeys[id], clientEndpoints[id]),
        needsKey,
        /** Where requests to this provider actually go. */
        baseUrl: endpoint.baseUrl,
        /** The sizes that apply with no override, for the Settings hints. */
        maxOutputTokens: sizes.maxOutputTokens,
        /** Seconds until a rate-limited provider is worth trying again. */
        cooldownSeconds: Math.ceil(cooldownRemaining(id) / 1000),
        /** Can the browser set that URL, and has the operator pinned it? */
        customEndpoint: Boolean(config.allowCustomEndpoint),
        endpointLocked: endpoint.locked,
        hasKey: Boolean(key),
        keySource: hasServerKey(id) ? "server" : key ? "client" : needsKey ? null : "none",
        models: [] as string[],
        /** The list was cut short, so a model may exist that is not in it. */
        truncated: false,
        error: null as string | null,
      };

      // A local server has no key and still has models to list, so this asks
      // whether the provider is usable rather than whether a key turned up.
      if (!base.ready) return base;

      try {
        const models = await listModels(id, key ?? "", clientEndpoints[id], force);
        // A pinned model is what will actually be used, so show it even when
        // the server lists others alongside it.
        const pinned = preferredModel(id);
        const listed = models.map((m) => m.id);
        return {
          ...base,
          models: pinned && !listed.includes(pinned) ? [pinned, ...listed] : listed,
          // Inferred from hitting the ceiling rather than reported by the
          // fetch, which would mean threading a second value through the
          // cache. A catalogue that lands on exactly the cap would be called
          // truncated when it wasn't; the note it produces only says a model
          // can also be typed in, which is true regardless.
          truncated: config.maxModels !== undefined && models.length >= config.maxModels,
        };
      } catch (err) {
        const message = ProviderError.is(err) ? err.message : (err as Error).message;
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
      // Upstream calls avoided versus made, so the cache is verifiable rather
      // than merely claimed.
      modelCache: { ...quotaStats },
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
