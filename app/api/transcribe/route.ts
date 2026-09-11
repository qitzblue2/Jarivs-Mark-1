import { NextRequest } from "next/server";
import { getProvider, resolveKey } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whisper is filtered out of the chat model list; it belongs here instead. */
const MODEL = process.env.JARVIS_WHISPER_MODEL || "whisper-large-v3";

/**
 * Speech to text via Groq Whisper.
 *
 * Free tier is 2,000 transcriptions a day at 217-228x realtime. The key stays
 * server-side, resolved exactly like the chat route so it never reaches the
 * browser.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return Response.json({ error: "No audio supplied." }, { status: 400 });
  }
  // Too short to contain speech — don't spend a request on it.
  if (audio.size < 1000) return Response.json({ text: "" });
  if (audio.size > 25 * 1024 * 1024) {
    return Response.json({ error: "Audio too large (25MB limit)." }, { status: 413 });
  }

  // A browser-supplied key is allowed, the same way the chat route allows one.
  const key = resolveKey("groq", req.headers.get("x-jarvis-key"));
  if (!key) {
    const p = getProvider("groq");
    return Response.json(
      { error: `Speech-to-text needs a Groq key. Add ${p.envKey} to .env.local — free at ${p.signupUrl}` },
      { status: 401 },
    );
  }

  const upstream = new FormData();
  upstream.append("file", audio, "speech.wav");
  upstream.append("model", MODEL);
  upstream.append("response_format", "json");
  const language = form.get("language");
  if (typeof language === "string" && language) upstream.append("language", language);

  try {
    const res = await fetch(`${getProvider("groq").baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: upstream,
      signal: req.signal,
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      const message =
        res.status === 401
          ? "Groq rejected the API key for transcription."
          : res.status === 429
            ? "Groq transcription rate limit reached (2,000/day on the free tier)."
            : `Transcription failed (${res.status}): ${detail}`;
      return Response.json({ error: message }, { status: res.status });
    }

    const json = await res.json();
    return Response.json({ text: String(json?.text ?? "").trim() });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return new Response(null, { status: 499 });
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
