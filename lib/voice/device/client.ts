import { consumeJarvisStream } from "@/lib/stream";
import { authConfigured, createToken, SESSION_COOKIE } from "@/lib/auth/session";
import { encodeWav } from "../wav";

/**
 * The device talking to its own API over loopback.
 *
 * It would be possible to call the provider directly from here, but then
 * persona, memory, tool calling, approval gating and provider fallback would
 * all need a second implementation that could quietly drift from the one the
 * browser uses. The Pi is a client of the same app everyone else talks to;
 * the only difference is that it is on the same machine.
 */

function baseUrl(): string {
  const port = process.env.PORT || "3000";
  return process.env.JARVIS_DEVICE_ORIGIN || `http://127.0.0.1:${port}`;
}

/**
 * Authenticate as itself.
 *
 * With `npm run start:lan` — which is how you reach the box from your phone —
 * a password is mandatory and every API call needs a session cookie, loopback
 * included. The device holds the same password the server does, so it signs
 * its own short-lived token rather than being given a second credential to
 * store. Nothing is sent off the machine: this request never leaves 127.0.0.1.
 */
async function authHeaders(): Promise<Record<string, string>> {
  if (!authConfigured()) return {};
  return { Cookie: `${SESSION_COOKIE}=${await createToken()}` };
}

export async function transcribeAudio(
  audio: Float32Array,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append("audio", encodeWav([audio]), "speech.wav");

  const res = await fetch(`${baseUrl()}/api/transcribe`, {
    method: "POST",
    body: form,
    headers: await authHeaders(),
    signal,
  });

  const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? `Transcription failed (${res.status}).`);
  return String(json.text ?? "").trim();
}

export interface AskOptions {
  /** Prior turns, so the device holds a conversation rather than one-shots. */
  history?: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  onToken?(soFar: string): void;
  onTool?(name: string): void;
  /**
   * A tool wants permission. There is nobody at the keyboard in a room, so
   * the caller decides what to do — currently: say so out loud and move on,
   * rather than hang the turn waiting for a click that isn't coming.
   */
  onApproval?(summary: string): void;
}

/** Ask the model, streaming the reply so speech can start on sentence one. */
export async function ask(question: string, options: AskOptions = {}): Promise<string> {
  const res = await fetch(`${baseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      messages: [...(options.history ?? []), { role: "user", content: question }],
    }),
    signal: options.signal,
  });

  if (!res.ok || !res.body) throw new Error(`Chat failed (${res.status}).`);

  let text = "";
  let error: string | null = null;

  await consumeJarvisStream(res.body, (event) => {
    switch (event.type) {
      case "token":
        text += event.value;
        options.onToken?.(text);
        break;
      case "tool_start":
        for (const call of event.calls) options.onTool?.(call.name);
        break;
      case "approval_request":
        options.onApproval?.(event.summary);
        break;
      case "error":
        error = event.message;
        break;
    }
  });

  if (error && !text) throw new Error(error);
  return text;
}
