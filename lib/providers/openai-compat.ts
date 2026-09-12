import { getProvider } from "./registry";
import { ProviderError, type ChatRequest, type ModelInfo } from "./types";
import { estimateTokens, trimToBudget, truncateMiddle } from "@/lib/tokens";

/**
 * One adapter for every OpenAI-compatible provider (Groq, Cerebras, GitHub
 * Models). They differ only in base URL, key, and context budget — all of
 * which live in the registry.
 */

function authHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/** Turn an upstream failure into something a user can act on. */
async function toProviderError(res: Response, label: string): Promise<ProviderError> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = json?.error?.message ?? json?.message ?? text;
    } catch {
      detail = text;
    }
  } catch {
    /* body already consumed or empty */
  }

  const snippet = detail.slice(0, 300);

  if (res.status === 401 || res.status === 403) {
    return new ProviderError(
      `${label} rejected the API key. Check it in Settings or your .env.local file.`,
      res.status,
      false,
    );
  }
  if (res.status === 429) {
    return new ProviderError(
      `${label} rate limit reached (free tier). ${snippet}`,
      429,
      true,
    );
  }
  if (res.status >= 500) {
    return new ProviderError(`${label} is having trouble: ${snippet}`, res.status, true);
  }
  return new ProviderError(`${label} error ${res.status}: ${snippet}`, res.status, false);
}

/** Live model list. Never hardcoded — provider lineups change often. */
export async function listModels(providerId: string, key: string): Promise<ModelInfo[]> {
  const p = getProvider(providerId);
  const res = await fetch(`${p.baseUrl}/models`, {
    headers: authHeaders(key),
    cache: "no-store",
  });

  if (!res.ok) throw await toProviderError(res, p.label);

  const json = await res.json();
  const rows: unknown[] = Array.isArray(json?.data) ? json.data : [];

  return rows
    .map((row) => (row as { id?: string })?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    // Drop non-chat models (whisper, TTS, guard/safety) — they can't hold a conversation.
    .filter((id) => !/whisper|tts|embed|guard|prompt-?guard|moderation/i.test(id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, provider: providerId }));
}

/** Open a streaming completion. Returns the raw upstream SSE body. */
/** True when the upstream 400 is specifically "this model has no tools". */
export function isToolsUnsupported(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false;
  if (err.status !== 400 && err.status !== 404 && err.status !== 422) return false;
  return /tool|function.?call/i.test(err.message);
}

export async function streamChat(
  providerId: string,
  key: string,
  req: ChatRequest,
): Promise<ReadableStream<Uint8Array>> {
  const p = getProvider(providerId);

  // Fit the conversation to this provider's free-tier window, leaving room for
  // the tool schemas we are about to send alongside it.
  const toolBudget = req.tools?.length
    ? estimateTokens(JSON.stringify(req.tools))
    : 0;
  const budget = Math.max(1000, p.maxContextTokens - toolBudget);

  const capped = req.messages.map((m) => ({
    ...m,
    // Only plain-text turns get truncated; a parts array carries images that
    // must survive intact or the request stops making sense.
    content:
      typeof m.content === "string"
        ? truncateMiddle(m.content, Math.floor(budget * 0.6))
        : m.content,
  }));
  const { messages } = trimToBudget(capped, budget);

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream: true,
    temperature: req.temperature ?? 0.7,
    max_tokens: p.maxOutputTokens,
  };

  // Send `tools` only when there are some — an empty array upsets some providers.
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: authHeaders(key),
    signal: req.signal,
    body: JSON.stringify(body),
  });

  if (!res.ok) throw await toProviderError(res, p.label);
  if (!res.body) throw new ProviderError(`${p.label} returned an empty stream.`, 502, true);

  return res.body;
}
