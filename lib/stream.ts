/**
 * SSE helpers. We parse the provider's OpenAI-style event stream and re-emit
 * our own typed events, so the browser never has to know provider specifics.
 */

export type JarvisEvent =
  | { type: "meta"; provider: string; model: string; fellBackFrom?: string }
  | { type: "token"; value: string }
  | { type: "done" }
  | { type: "error"; message: string; status?: number };

export function encodeEvent(event: JarvisEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
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

/** Pull the incremental text out of an OpenAI-style chunk. */
export function extractDelta(payload: string): string | null {
  try {
    const json = JSON.parse(payload);
    const delta = json?.choices?.[0]?.delta;
    if (typeof delta?.content === "string") return delta.content;
    // Some providers emit reasoning separately; ignore it in Mark 1.
    return null;
  } catch {
    return null;
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
