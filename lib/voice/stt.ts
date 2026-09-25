import { encodeWav } from "./wav";

/** Send captured PCM frames to the server for transcription. */
export async function transcribe(
  frames: Float32Array[],
  options: { key?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const form = new FormData();
  form.append("audio", encodeWav(frames), "speech.wav");

  const headers: Record<string, string> = {};
  if (options.key) headers["x-jarvis-key"] = options.key;

  const res = await fetch("/api/transcribe", {
    method: "POST",
    body: form,
    headers,
    signal: options.signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `Transcription failed (${res.status}).`);
  return String(json?.text ?? "").trim();
}
