import { getTool } from "./registry";
import type { ToolCall, ToolContext, ToolResult } from "./types";

/** Tool output is fed straight back into the context window — keep it bounded. */
const MAX_RESULT_CHARS = 6000;

function clamp(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated, ${text.length - MAX_RESULT_CHARS} more characters]`;
}

/**
 * Execute one tool call.
 *
 * Never throws: a thrown error becomes an error *result*, because the model
 * can usually recover from being told what went wrong, whereas killing the
 * turn loses the whole conversation.
 */
export async function runToolCall(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now();
  const base = { toolCallId: call.id, name: call.name };

  const tool = getTool(call.name);
  if (!tool) {
    return { ...base, content: `No such tool: "${call.name}".`, isError: true, ms: 0 };
  }

  let args: Record<string, unknown>;
  try {
    // Models sometimes emit "" or "{}" for a no-argument call.
    args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
  } catch {
    return {
      ...base,
      content: `Arguments were not valid JSON: ${call.arguments.slice(0, 200)}`,
      isError: true,
      ms: Date.now() - started,
    };
  }

  try {
    const content = await tool.handler(args, ctx);
    return { ...base, content: clamp(content), isError: false, ms: Date.now() - started };
  } catch (err) {
    return {
      ...base,
      content: `Error: ${(err as Error).message}`,
      isError: true,
      ms: Date.now() - started,
    };
  }
}

/** Run a round's calls in parallel — they're independent by construction. */
export function runToolCalls(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
  return Promise.all(calls.map((call) => runToolCall(call, ctx)));
}
