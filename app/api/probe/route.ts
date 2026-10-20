import { NextRequest } from "next/server";
import { streamChat } from "@/lib/providers/openai-compat";
import { getProvider, resolveEndpoint, resolveKey } from "@/lib/providers/registry";
import { ProviderError } from "@/lib/providers/types";
import { extractChunk, readSSE, ToolCallAccumulator } from "@/lib/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Does this model actually work as JARVIS's brain?
 *
 * The question that matters is not how a provider markets itself, it is
 * whether a given model reliably CALLS TOOLS — because that is what moves
 * the projector, searches the web and remembers anything. Everything else
 * degrades; tool calling either happens or JARVIS silently does nothing and
 * looks broken.
 *
 * Nothing catches the important failure today. `isToolsUnsupported` catches a
 * model that rejects the `tools` parameter outright, but a model that accepts
 * it and then never calls one — the usual behaviour of a roleplay-tuned
 * fine-tune — passes every check and simply ignores your projector. This
 * turns that into a five-second measurement.
 *
 * One tool, one round, no agent loop: the point is a clean signal, not a
 * realistic turn.
 */
const PROBE_TOOL = {
  type: "function" as const,
  function: {
    name: "get_time",
    description: "The current date and time. Call this to answer questions about today.",
    parameters: {
      type: "object",
      properties: { timezone: { type: "string" } },
    },
  },
};

const PROMPT = "What is today's date? Use your tools to find out — do not guess.";

export interface ProbeResult {
  ok: boolean;
  /** The one that matters: did it actually call the tool? */
  calledTool: boolean;
  toolName?: string;
  /** Time to the first token or tool-call fragment, in ms. */
  firstByteMs: number;
  /** Rough generation rate; only meaningful when it produced prose. */
  tokensPerSecond: number;
  totalMs: number;
  /** What it said instead, when it didn't call anything. */
  saidInstead?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  let body: { provider?: string; model?: string; endpoint?: string; key?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed request body." }, { status: 400 });
  }

  const providerId = String(body.provider ?? "");
  const model = String(body.model ?? "");
  if (!providerId || !model) {
    return Response.json({ ok: false, error: "Pick a provider and a model first." }, { status: 400 });
  }

  let config;
  try {
    config = getProvider(providerId, body.endpoint);
  } catch {
    return Response.json({ ok: false, error: `Unknown provider: ${providerId}` }, { status: 400 });
  }

  const endpoint = resolveEndpoint(providerId, body.endpoint);
  const key = resolveKey(providerId, body.key, endpoint.fromClient) ?? "";

  const started = Date.now();
  let firstByteMs = 0;
  let text = "";
  const accumulator = new ToolCallAccumulator();

  try {
    const stream = await streamChat(providerId, key, {
      model,
      messages: [{ role: "user", content: PROMPT }],
      tools: [PROBE_TOOL],
      endpoint: body.endpoint,
      // Short: this is a probe, not an answer.
      budget: { maxOutput: 256 },
    });

    for await (const payload of readSSE(stream)) {
      if (payload === "[DONE]") break;
      const chunk = extractChunk(payload);
      // First sign of life either way — prose or a tool-call fragment.
      if (!firstByteMs && (chunk.content || chunk.toolCalls.length > 0)) {
        firstByteMs = Date.now() - started;
      }
      if (chunk.content) text += chunk.content;
      if (chunk.toolCalls.length > 0) accumulator.add(chunk.toolCalls);
    }
  } catch (err) {
    const message = ProviderError.is(err) ? err.message : (err as Error).message;
    return Response.json({ ok: false, calledTool: false, error: message } satisfies Partial<ProbeResult>);
  }

  const totalMs = Date.now() - started;
  const calls = accumulator.finish();
  // ~4 characters a token is close enough to tell 5 tok/s from 500.
  const tokensPerSecond = text ? Math.round(text.length / 4 / (totalMs / 1000)) : 0;

  const result: ProbeResult = {
    ok: true,
    calledTool: calls.length > 0,
    toolName: calls[0]?.name,
    firstByteMs,
    tokensPerSecond,
    totalMs,
    saidInstead: calls.length === 0 ? text.slice(0, 160) : undefined,
  };

  return Response.json({ ...result, label: config.label });
}
