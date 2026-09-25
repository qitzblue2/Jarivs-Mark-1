import { NextRequest } from "next/server";
import { getProvider, resolveKey } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.JARVIS_TTS_MODEL || "playai-tts";
const DEFAULT_VOICE = process.env.JARVIS_TTS_VOICE || "Fritz-PlayAI";

/** Text to speech via Groq, proxied so the key never reaches the browser. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim();

  if (!text) return Response.json({ error: "No text to speak." }, { status: 400 });
  if (text.length > 4000) {
    return Response.json({ error: "Text too long for speech (4000 chars)." }, { status: 413 });
  }

  const key = resolveKey("groq", req.headers.get("x-jarvis-key"));
  if (!key) {
    return Response.json(
      { error: "Groq TTS needs a Groq key — switch to the browser voice in Settings." },
      { status: 401 },
    );
  }

  try {
    const res = await fetch(`${getProvider("groq").baseUrl}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        model: MODEL,
        voice: body?.voice || DEFAULT_VOICE,
        input: text,
        response_format: "wav",
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 250);
      return Response.json(
        {
          error:
            res.status === 429
              ? "Groq TTS rate limit reached. The browser voice has no limit."
              : `Speech generation failed (${res.status}): ${detail}`,
        },
        { status: res.status },
      );
    }

    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return new Response(null, { status: 499 });
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
