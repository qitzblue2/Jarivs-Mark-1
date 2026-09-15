import { NextRequest } from "next/server";

import {
  defaultProviderId,
  fallbackOrder,
  getProvider,
  preferredModel,
  requiresKey,
  resolveEndpoint,
  resolveKey,
  PROVIDER_IDS,
} from "@/lib/providers/registry";
import { ProviderError, type ContentPart, type WireMessage } from "@/lib/providers/types";
import { supportsVision } from "@/lib/providers/registry";
import { attachmentsToText, MAX_IMAGES } from "@/lib/attachments";
import type { Attachment } from "@/lib/types";
import { encodeEvent, type JarvisEvent } from "@/lib/stream";
import { runAgentTurn } from "@/lib/agent";
import { denyAll } from "@/lib/tools/fs/approval";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { forPrompt, getMemory } from "@/lib/memory";

export const runtime = "nodejs";
// This route streams; never let a CDN or the router cache it.
export const dynamic = "force-dynamic";

/** What the client sends: plain messages plus any attachments per turn. */
interface IncomingMessage {
  role: WireMessage["role"];
  content: string;
  attachments?: Attachment[];
}

interface ChatBody {
  messages: IncomingMessage[];
  provider?: string;
  model?: string;
  temperature?: number;
  persona?: string;
  /** Set false to disable tool use for this turn. */
  useTools?: boolean;
  /** Bring-your-own keys from Settings, keyed by provider id. */
  keys?: Record<string, string>;
  /** Base URLs from Settings, for slots that allow one. */
  endpoints?: Record<string, string>;
  /** Context and output sizes from Settings, for those same slots. */
  budgets?: Record<string, { context?: number; maxOutput?: number }>;
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

  const {
    messages, model, temperature, persona, useTools,
    keys = {}, endpoints = {}, budgets = {},
  } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return errorStream("No messages to send.", 400);
  }

  const primary = body.provider && PROVIDER_IDS.includes(body.provider)
    ? body.provider
    : defaultProviderId();

  /**
   * Turn attachments into wire content.
   *
   * Text-bearing files are folded into the prompt. Images become multimodal
   * parts, but only when the target model actually accepts them — otherwise
   * they are described in text so the model can at least say it can't see
   * them, instead of the provider rejecting the whole request.
   */
  const toWire = (message: IncomingMessage, visionOk: boolean): WireMessage => {
    const attachments = message.attachments ?? [];
    if (attachments.length === 0) return { role: message.role, content: message.content };

    const textual = attachments.filter((a) => a.kind === "text");
    const images = attachments.filter((a) => a.kind === "image" && a.dataUrl);

    const textBlock = [message.content, attachmentsToText([...textual, ...(visionOk ? [] : images)])]
      .filter(Boolean)
      .join("\n\n");

    if (!visionOk || images.length === 0) {
      return { role: message.role, content: textBlock };
    }

    const parts: ContentPart[] = [{ type: "text", text: textBlock }];
    for (const image of images.slice(0, MAX_IMAGES)) {
      parts.push({ type: "image_url", image_url: { url: image.dataUrl! } });
    }
    return { role: message.role, content: parts };
  };

  // Relevant memories join the system prompt. Done server-side so every
  // entry point gets them — typed chat, voice, and any future client.
  let memoryBlock = "";
  try {
    const entries = await getMemory().list();
    if (entries.length > 0) {
      // Score against the recent conversation, not just the last line, so a
      // follow-up like "what about the other one?" still recalls usefully.
      const query = messages.slice(-3).map((m) => m.content).join(" ");
      const chosen = forPrompt(entries, query);
      if (chosen.length > 0) {
        memoryBlock =
          "\n\nWhat you remember about this user:\n" +
          chosen.map((e) => `- ${e.text}`).join("\n") +
          "\n\nUse these when relevant. Don't recite them unprompted, and don't " +
          "claim to remember anything that isn't listed.";
      }
    }
  } catch {
    // Memory is an enhancement; a read failure must not break the chat.
  }

  // Prepend the persona unless the caller already supplied a system turn.
  const systemPrompt = (persona?.trim() || DEFAULT_PERSONA) + memoryBlock;
  const hasImages = messages.some((m) => m.attachments?.some((a) => a.kind === "image"));

  // Try the chosen provider, then everything else that is configured. Two
  // free keys are only worth having if a rate limit on one rolls over to the
  // other — and a local server is worth having because it never rate-limits
  // at all, which is why it sits at the end of this list.
  const order = fallbackOrder(primary, keys, endpoints);

  if (order.length === 0) {
    const p = getProvider(primary);
    return errorStream(
      `No API key for ${p.label}. Add ${p.envKey} to .env.local, or paste a key in Settings. Get a free one at ${p.signupUrl}`,
      401,
    );
  }

  let lastError: ProviderError | null = null;

  for (const providerId of order) {
    const endpoint = resolveEndpoint(providerId, endpoints[providerId]);
    // Empty string, not null: a local server needs no key, and `fallbackOrder`
    // has already established that this provider is usable.
    const key = resolveKey(providerId, keys[providerId], endpoint.fromClient) ?? "";
    if (!key && requiresKey(providerId)) continue;

    const config = getProvider(providerId, endpoints[providerId], budgets[providerId]);
    // The requested model only applies to the provider it was chosen for.
    const useModel =
      providerId === primary && model ? model : await firstModel(providerId, key, endpoints[providerId]);
    if (!useModel) {
      lastError = new ProviderError(`No usable model found on ${config.label}.`, 502, true);
      continue;
    }

    // Vision support is per provider AND per model, so the conversation is
    // built inside the fallback loop rather than once up front.
    const visionOk = hasImages && supportsVision(providerId, useModel);
    const wire: WireMessage[] = messages[0]?.role === "system"
      ? messages.map((m) => toWire(m, visionOk))
      : [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => toWire(m, visionOk)),
        ];

    try {
      const turn = runAgentTurn(wire, {
        providerId,
        key,
        model: useModel,
        temperature,
        signal: req.signal,
        useTools,
        endpoint: endpoints[providerId],
        budget: budgets[providerId],
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
          // Deny anything still waiting, or a killed turn leaves a tool
          // parked on a promise nobody will ever answer.
          denyAll();
          void turn.return(undefined);
        },
      });

      return sseResponse(stream);
    } catch (err) {
      if (ProviderError.is(err)) {
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

/**
 * Which model to use for a provider the user didn't explicitly pick.
 *
 * A pinned model wins outright and is not checked against the list: if you
 * named it, you meant it, and a typo failing loudly as "model not found"
 * beats silently answering with a different model. Otherwise it is whatever
 * the provider lists first, which is alphabetical and therefore arbitrary —
 * fine for a cloud provider serving one lineup, which is why pinning exists
 * for the local server serving whatever you happen to have pulled.
 */
async function firstModel(
  providerId: string,
  key: string,
  endpoint?: string,
): Promise<string | null> {
  const pinned = preferredModel(providerId);
  if (pinned) return pinned;

  const { listModels } = await import("@/lib/providers/openai-compat");
  try {
    const models = await listModels(providerId, key, endpoint);
    return models[0]?.id ?? null;
  } catch {
    return null;
  }
}
