/**
 * SSE helpers. We parse the provider's OpenAI-style event stream and re-emit
 * our own typed events, so the browser never has to know provider specifics.
 */

export type JarvisEvent =
  | { type: "meta"; provider: string; model: string; fellBackFrom?: string }
  | { type: "token"; value: string }
  /** A tool round is starting; `round` is 1-based. */
  | { type: "tool_start"; round: number; calls: { id: string; name: string; arguments: string }[] }
  /** That round's results came back. */
  | { type: "tool_end"; round: number; results: { toolCallId: string; name: string; content: string; isError: boolean; ms: number }[] }
  /** The model does not support tools; we retried without them. */
  | { type: "tools_unsupported"; model: string }
  /** A tool needs the user to approve something before it can run. */
  | {
      type: "approval_request";
      id: string;
      kind: "write" | "command";
      summary: string;
      detail?: string;
      path?: string;
    }
  | { type: "done" }
  | { type: "error"; message: string; status?: number };

/**
 * Frame any typed event as SSE.
 *
 * Separate from `encodeEvent` so the chat route keeps its narrow type — a
 * malformed JarvisEvent should be a build error there — while the display
 * stream, which carries a different union, can use the same framing without
 * this module having to know what a display is.
 */
export function encodeSSE(event: { type: string }): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function encodeEvent(event: JarvisEvent): Uint8Array {
  return encodeSSE(event);
}

/**
 * Turn a raw SSE byte stream into `data:` payload strings, handling chunk
 * boundaries that split an event in half.
 */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line.
      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload) yield payload;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** One streamed fragment of a tool call, as OpenAI-compatible APIs emit them. */
export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  /** A slice of the JSON arguments string — NOT valid JSON on its own. */
  arguments?: string;
}

export interface Chunk {
  content: string | null;
  toolCalls: ToolCallDelta[];
  finishReason: string | null;
}

/** Pull text, tool-call fragments and the finish reason out of one SSE chunk. */
export function extractChunk(payload: string): Chunk {
  const empty: Chunk = { content: null, toolCalls: [], finishReason: null };
  try {
    const json = JSON.parse(payload);
    const choice = json?.choices?.[0];
    const delta = choice?.delta;
    if (!delta) return { ...empty, finishReason: choice?.finish_reason ?? null };

    const toolCalls: ToolCallDelta[] = Array.isArray(delta.tool_calls)
      ? delta.tool_calls.map((tc: Record<string, unknown>, i: number) => ({
          index: typeof tc.index === "number" ? tc.index : i,
          id: typeof tc.id === "string" ? tc.id : undefined,
          name: (tc.function as { name?: string } | undefined)?.name,
          arguments: (tc.function as { arguments?: string } | undefined)?.arguments,
        }))
      : [];

    return {
      content: typeof delta.content === "string" ? delta.content : null,
      toolCalls,
      finishReason: choice?.finish_reason ?? null,
    };
  } catch {
    return empty;
  }
}

/** Kept for the text-only path and existing tests. */
export function extractDelta(payload: string): string | null {
  return extractChunk(payload).content;
}

/**
 * Reassembles tool calls that arrive in fragments.
 *
 * Providers stream `arguments` as a JSON string split across arbitrary chunk
 * boundaries — often mid-token, e.g. `{"expr` then `ession":"2+` then `2"}`.
 * Fragments are keyed by `index`, since `id` and `name` typically appear only
 * on the first fragment of each call. Parsing before the stream ends yields
 * malformed JSON, so nothing is parsed here.
 */
export class ToolCallAccumulator {
  private byIndex = new Map<number, { id: string; name: string; arguments: string }>();

  add(deltas: ToolCallDelta[]): void {
    for (const delta of deltas) {
      const existing = this.byIndex.get(delta.index) ?? { id: "", name: "", arguments: "" };
      this.byIndex.set(delta.index, {
        id: delta.id ?? existing.id,
        name: delta.name ?? existing.name,
        arguments: existing.arguments + (delta.arguments ?? ""),
      });
    }
  }

  get isEmpty(): boolean {
    return this.byIndex.size === 0;
  }

  /** Completed calls in index order. */
  finish(): { id: string; name: string; arguments: string }[] {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        ...call,
        // Some providers omit the id entirely; the loop still needs a stable one.
        id: call.id || `call_${index}`,
      }))
      .filter((call) => call.name);
  }
}

/** Consume a Jarvis event stream in the browser. */
export async function consumeJarvisStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: JarvisEvent) => void,
): Promise<void> {
  for await (const payload of readSSE(body)) {
    try {
      onEvent(JSON.parse(payload) as JarvisEvent);
    } catch {
      // Ignore malformed frames rather than killing the stream.
    }
  }
}
