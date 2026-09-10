import { NextRequest } from "next/server";

import { defaultProviderId, getProvider, resolveKey, PROVIDER_IDS } from "@/lib/providers/registry";
import { ProviderError, type WireMessage } from "@/lib/providers/types";
import { encodeEvent, type JarvisEvent } from "@/lib/stream";
import { runAgentTurn } from "@/lib/agent";
import { DEFAULT_PERSONA } from "@/lib/persona";

export const runtime = "nodejs";
// This route streams; never let a CDN or the router cache it.
export const dynamic = "force-dynamic";

interface ChatBody {
  messages: WireMessage[];
  provider?: string;
  model?: string;
  temperature?: number;
  persona?: string;
  /** Set false to disable tool use for this turn. */
  useTools?: boolean;
  /** Bring-your-own keys from Settings, keyed by provider id. */
  keys?: Record<string, string>;
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx-style proxies from buffering the stream into one chunk.
      "X-Accel-Buffering": "no",
    },
  });
}

function errorStream(message: string, status?: number): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeEvent({ type: "error", message, status }));
      controller.close();
    },
  });
  return sseResponse(stream);
}

export async function POST(req: NextRequest) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return errorStream("Malformed request body.", 400);
  }

  const { messages, model, temperature, persona, useTools, keys = {} } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return errorStream("No messages to send.", 400);
  }

  const primary = body.provider && PROVIDER_IDS.includes(body.provider)
    ? body.provider
    : defaultProviderId();

  // Prepend the persona unless the caller already supplied a system turn.
  const withPersona: WireMessage[] = messages[0]?.role === "system"
    ? messages
    : [{ role: "system", content: persona?.trim() || DEFAULT_PERSONA }, ...messages];

  // Try the chosen provider, then any other provider that has a key. Two free
  // keys are only worth having if a rate limit on one rolls over to the other.
  const order = [primary, ...PROVIDER_IDS.filter((id) => id !== primary)]
    .filter((id) => resolveKey(id, keys[id]));

  if (order.length === 0) {
    const p = getProvider(primary);
    return errorStream(
      `No API key for ${p.label}. Add ${p.envKey} to .env.local, or paste a key in Settings. Get a free one at ${p.signupUrl}`,
      401,
    );
  }

  let lastError: ProviderError | null = null;

  for (const providerId of order) {
    const key = resolveKey(providerId, keys[providerId]);
    if (!key) continue;

    const config = getProvider(providerId);
    // The requested model only applies to the provider it was chosen for.
    const useModel = providerId === primary && model ? model : await firstModel(providerId, key);
    if (!useModel) {
      lastError = new ProviderError(`No usable model found on ${config.label}.`, 502, true);
      continue;
    }

    try {
      const turn = runAgentTurn(withPersona, {
        providerId,
        key,
        model: useModel,
        temperature,
        signal: req.signal,
        useTools,
      });

      // Pull the first event before responding: the agent's opening upstream
      // call happens here, so an auth error or rate limit still lands in the
      // catch below and can fall back to the next provider. Once we have
      // returned a 200 stream, falling back is no longer possible.
      const first = await turn.next();

      const fellBackFrom = providerId === primary ? undefined : primary;

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: JarvisEvent) => controller.enqueue(encodeEvent(event));
          send({ type: "meta", provider: providerId, model: useModel, fellBackFrom });

          try {
            if (!first.done && first.value) send(first.value);
            for await (const event of turn) send(event);
            send({ type: "done" });
          } catch (err) {
            // The client aborting is normal (Stop button), not an error.
            if ((err as Error)?.name !== "AbortError") {
              send({ type: "error", message: (err as Error).message || "Stream failed." });
            }
          } finally {
            controller.close();
          }
        },
        cancel() {
          void turn.return(undefined);
        },
      });

      return sseResponse(stream);
    } catch (err) {
      if (err instanceof ProviderError) {
        lastError = err;
        // Only roll over on rate limits and outages — a bad key or bad request
        // will fail the same way everywhere.
        if (!err.retryable) break;
        continue;
      }
      if ((err as Error)?.name === "AbortError") return new Response(null, { status: 499 });
      lastError = new ProviderError((err as Error).message || "Request failed.", 500, true);
    }
  }

  return errorStream(lastError?.message ?? "Every configured provider failed.", lastError?.status);
}

/** Cheap model fallback for a provider the user didn't explicitly pick. */
async function firstModel(providerId: string, key: string): Promise<string | null> {
  const { listModels } = await import("@/lib/providers/openai-compat");
  try {
    const models = await listModels(providerId, key);
    return models[0]?.id ?? null;
  } catch {
    return null;
  }
}
