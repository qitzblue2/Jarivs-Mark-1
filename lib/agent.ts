import { isToolsUnsupported, streamChat } from "@/lib/providers/openai-compat";
import type { WireMessage } from "@/lib/providers/types";
import { runToolCalls } from "@/lib/tools/run";
import { allTools } from "@/lib/tools/registry";
import { toWireTool } from "@/lib/tools/types";
import { extractChunk, readSSE, ToolCallAccumulator, type JarvisEvent } from "@/lib/stream";
import { denyAll } from "@/lib/tools/fs/approval";

/**
 * Cap on tool rounds for an ordinary chat turn.
 *
 * Each round is a full upstream request, so an unbounded loop would burn a
 * free-tier quota (Groq allows ~30/min) in seconds. On the last round tools are
 * withheld, which forces the model to answer with what it has.
 *
 * A task run raises this — see `agentRounds` in the registry — but only when
 * the user asks for one, and only as far as the chosen provider can afford.
 */
export const MAX_ROUNDS = 5;

export interface AgentOptions {
  providerId: string;
  key: string;
  model: string;
  temperature?: number;
  signal?: AbortSignal;
  /** Set false to run a plain completion with no tools at all. */
  useTools?: boolean;
  /** Base URL chosen in Settings, for a slot that permits one. */
  endpoint?: string;
  /** Context and output sizes chosen in Settings, for the same slot. */
  budget?: { context?: number; maxOutput?: number };
  /**
   * Tool rounds this turn may use. Defaults to the ordinary chat cap; the
   * route raises it for a task run.
   */
  maxRounds?: number;
  /**
   * The goal of a task run, pinned so trimming cannot drop it.
   *
   * A long run accumulates tool output until `trimToBudget` starts discarding
   * the oldest groups — and the oldest group is the instruction itself, so
   * the run would carry on working on something it could no longer read.
   * Restating it as a system message is enough, because trimming preserves
   * those unconditionally.
   */
  goal?: string;
}

/**
 * Run one assistant turn to completion, executing tool calls as the model
 * asks for them.
 *
 * Yields UI events as they happen: text streams token by token, and each tool
 * round is announced before it runs and reported after. The conversation is
 * extended in place so the caller can persist the full exchange.
 */
export async function* runAgentTurn(
  history: WireMessage[],
  options: AgentOptions,
): AsyncGenerator<JarvisEvent> {
  const { providerId, key, model, temperature, signal, endpoint, budget } = options;

  const maxRounds = Math.max(1, options.maxRounds ?? MAX_ROUNDS);

  const messages = [...history];
  // Pinned ahead of the history so it reads as standing instruction rather
  // than the latest thing said, and survives every trim.
  if (options.goal) {
    messages.unshift({
      role: "system",
      content: `The task you are working on, in the user's words: ${options.goal}`,
    });
  }

  const tools = allTools().map(toWireTool);
  // Flips to false if the model turns out not to support tools.
  let toolsEnabled = options.useTools !== false && tools.length > 0;

  for (let round = 1; round <= maxRounds; round++) {
    // Withhold tools on the final round so the model has to conclude.
    const offerTools = toolsEnabled && round < maxRounds;

    let upstream: ReadableStream<Uint8Array>;
    try {
      upstream = await streamChat(providerId, key, {
        messages,
        model,
        temperature,
        signal,
        endpoint,
        budget,
        tools: offerTools ? tools : undefined,
      });
    } catch (err) {
      // Some free models reject the `tools` parameter outright. Retry clean
      // once rather than failing the turn.
      if (offerTools && isToolsUnsupported(err)) {
        yield { type: "tools_unsupported", model };
        toolsEnabled = false;
        upstream = await streamChat(providerId, key, {
          messages,
          model,
          temperature,
          signal,
          endpoint,
          budget,
        });
      } else {
        throw err;
      }
    }

    const accumulator = new ToolCallAccumulator();
    let text = "";

    for await (const payload of readSSE(upstream)) {
      if (payload === "[DONE]") break;
      const chunk = extractChunk(payload);

      if (chunk.content) {
        text += chunk.content;
        yield { type: "token", value: chunk.content };
      }
      if (chunk.toolCalls.length > 0) accumulator.add(chunk.toolCalls);
    }

    // No tools requested — this was the final answer.
    if (accumulator.isEmpty) return;

    const calls = accumulator.finish();
    if (calls.length === 0) return;

    yield { type: "tool_start", round, calls, maxRounds };

    /**
     * Approval requests arrive while runToolCalls is awaiting, so they are
     * queued here and drained as they appear. A generator can't yield from
     * inside a callback, so the callback pushes and the drain loop yields.
     */
    const queue: JarvisEvent[] = [];
    const resultsPromise = runToolCalls(calls, {
      signal,
      onApprovalRequest: (request) => {
        queue.push({
          type: "approval_request",
          id: request.id,
          kind: request.kind,
          summary: request.summary,
          detail: request.detail,
          path: request.path,
        });
      },
    });

    let settled = false;
    void resultsPromise.then(() => {
      settled = true;
    });

    // Pump the queue until the tools finish, so an approval card reaches the
    // browser while the tool is still waiting for the answer.
    while (!settled) {
      while (queue.length > 0) yield queue.shift()!;
      await new Promise((r) => setTimeout(r, 40));
    }
    while (queue.length > 0) yield queue.shift()!;

    const results = await resultsPromise;

    yield { type: "tool_end", round, results, maxRounds };

    // Feed the exchange back so the next round sees what the tools returned.
    messages.push({
      role: "assistant",
      content: text,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const result of results) {
      messages.push({
        role: "tool",
        content: result.content,
        tool_call_id: result.toolCallId,
        name: result.name,
      });
    }
  }
}
