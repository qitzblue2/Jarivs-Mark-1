import { encodeSSE } from "@/lib/stream";
import { ping, subscribe } from "@/lib/display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The stream each display subscribes to.
 *
 * SSE rather than a WebSocket because a display only ever receives. Adding a
 * socket server to Next means running a second process for a one-way channel
 * this app already has plumbing for — the framing here is the same the chat
 * route streams tokens with.
 *
 * `subscribe` replays the current content on connect, so a kiosk browser that
 * just restarted shows what is current instead of sitting blank until someone
 * says something.
 */
export function GET(req: Request) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const unsubscribe = subscribe((event) => {
        if (closed) return;
        try {
          controller.enqueue(encodeSSE(event));
        } catch {
          closed = true;
        }
      });

      // A projector can sit untouched for hours. Without traffic, a proxy or
      // a sleeping WiFi chip drops the connection silently and the display
      // stops updating while still looking connected.
      const heartbeat = setInterval(ping, 20_000);

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed by the client going away */
        }
      };

      req.signal.addEventListener("abort", stop, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx-style proxies buffering the stream into one chunk.
      "X-Accel-Buffering": "no",
    },
  });
}
