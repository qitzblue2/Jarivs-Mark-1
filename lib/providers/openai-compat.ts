import { getProvider } from "./registry";
import { cachedModels } from "./quota";
import { ProviderError, type ChatRequest, type ModelInfo, type ProviderConfig } from "./types";
import { estimateTokens, trimToBudget, truncateMiddle } from "@/lib/tokens";

/**
 * One adapter for every OpenAI-compatible provider (Groq, Cerebras, GitHub
 * Models). They differ only in base URL, key, and context budget — all of
 * which live in the registry.
 */

function authHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Omitted entirely for a local server rather than sent empty: a bare
  // "Bearer " is a malformed credential, and some servers reject it outright
  // instead of ignoring it the way Ollama does.
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/**
 * Bound how long we wait for a provider to answer.
 *
 * `done()` must be called as soon as the response headers arrive. For a
 * streaming completion the fetch promise resolves at the headers, and the
 * body may then take minutes on a CPU model — clearing the timer there is
 * what separates "this machine is thinking" from "this machine is not there".
 */
function deadline(signal: AbortSignal | undefined, ms: number | undefined) {
  if (!ms) return { signal, done: () => {}, expired: () => false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    done: () => clearTimeout(timer),
    expired: () => controller.signal.aborted,
  };
}

/**
 * A failure to connect, phrased as something you can act on.
 *
 * Without this a switched-off home server surfaces as the browser's bare
 * "fetch failed", which names neither the machine nor the address.
 */
function toNetworkError(err: unknown, label: string, url: string, timedOut: boolean): never {
  // The caller hitting Stop is not a provider failure.
  if (!timedOut && (err as Error)?.name === "AbortError") throw err;

  const cause = (err as { cause?: { code?: string } })?.cause?.code;
  const reason = timedOut
    ? "did not respond in time"
    : cause === "ECONNREFUSED"
      ? "refused the connection"
      : "could not be reached";

  throw new ProviderError(`${label} ${reason} at ${url}. Is it running?`, 503, true);
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

  /**
   * Not every provider says 401 when it means "bad key".
   *
   * Gemini answers a missing credential with 404 "Requested entity was not
   * found" and a malformed one with 400 — both verified against the live
   * endpoint. Left unrecognised those fall through to the generic branch
   * below, which is marked non-retryable, so one typo in a Gemini key would
   * stop the whole fallback chain instead of rolling on to the next
   * provider. The body is what distinguishes them from a real bad request.
   */
  const looksLikeAuth =
    (res.status === 400 || res.status === 404) &&
    /api[ _-]?key|credential|unauthenticat|permission|not found/i.test(detail);

  if (res.status === 401 || res.status === 403 || looksLikeAuth) {
    /**
     * A 403 is ambiguous in a way a 401 is not.
     *
     * 401 is an authentication challenge and means what it says. 403 is what
     * proxies, school and workplace filters, and WAFs all return when they
     * block a host — so a network that cannot reach a provider is
     * indistinguishable from a rejected key unless the body mentions one.
     * Observed here: a blocking proxy's 403 read as "rejected the API key",
     * which sends you off regenerating a key that was never the problem.
     */
    const mentionsAuth = /api[ _-]?key|credential|unauthori[sz]|token|permission/i.test(detail);
    const ambiguous = res.status === 403 && !mentionsAuth;

    return new ProviderError(
      ambiguous
        ? `${label} refused the request (403) without saying why. Either the API key is ` +
          `wrong, or something on your network — a school or office filter, a proxy — is ` +
          `blocking ${label}.`
        : `${label} rejected the API key. Check it in Settings or your .env.local file.`,
      res.status,
      // Retryable so a key that is wrong for ONE provider lets the others
      // answer. A key that is wrong everywhere still ends with a clear error.
      true,
    );
  }
  if (res.status === 429) {
    // Providers state the wait in seconds, or as an HTTP date. Either beats
    // guessing, since guessing short wastes a request and guessing long
    // sidelines a provider that was ready.
    const header = res.headers.get("retry-after");
    const seconds = Number(header);
    const retryAfterMs = Number.isFinite(seconds)
      ? seconds * 1000
      : header
        ? Math.max(0, Date.parse(header) - Date.now()) || undefined
        : undefined;

    return new ProviderError(
      `${label} rate limit reached (free tier). ${snippet}`,
      429,
      true,
      retryAfterMs,
    );
  }
  if (res.status >= 500) {
    return new ProviderError(`${label} is having trouble: ${snippet}`, res.status, true);
  }
  return new ProviderError(`${label} error ${res.status}: ${snippet}`, res.status, false);
}

/** Live model list. Never hardcoded — provider lineups change often. */
export async function listModels(
  providerId: string,
  key: string,
  endpoint?: string | null,
  /** Skip the cache. For the Settings Test button, which must ask live. */
  force = false,
): Promise<ModelInfo[]> {
  // No budget: listing models does not depend on context sizing.
  const p = getProvider(providerId, endpoint);
  return cachedModels(providerId, p.baseUrl, key, () => fetchModels(p, key), force);
}

/** The uncached fetch. Only `listModels` should call this. */
async function fetchModels(p: ProviderConfig, key: string): Promise<ModelInfo[]> {
  const providerId = p.id;
  const guard = deadline(undefined, p.probeTimeoutMs);

  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/models${p.modelsQuery ? `?${p.modelsQuery}` : ""}`, {
      headers: authHeaders(key),
      cache: "no-store",
      signal: guard.signal,
    });
  } catch (err) {
    toNetworkError(err, p.label, p.baseUrl, guard.expired());
  } finally {
    guard.done();
  }

  if (!res.ok) throw await toProviderError(res, p.label);

  const json = await res.json();
  const rows: unknown[] = Array.isArray(json?.data) ? json.data : [];

  return rows
    .map((row) => (row as { id?: string })?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    // Drop non-chat models (whisper, TTS, guard/safety) — they can't hold a conversation.
    .filter((id) => !/whisper|tts|embed|guard|prompt-?guard|moderation/i.test(id))
    // Cut in the upstream's own order, BEFORE sorting. Sorting first and then
    // cutting would keep whatever sorts earliest, and on a catalogue of Hugging
    // Face repo ids that is several hundred forgotten fine-tunes beginning with
    // a digit, and no Qwen — the list would be long, alphabetical and useless.
    // A provider that sets no ceiling slices to `undefined` and keeps the lot.
    .slice(0, p.maxModels)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, provider: providerId }));
}

/** Open a streaming completion. Returns the raw upstream SSE body. */
/** True when the upstream 400 is specifically "this model has no tools". */
export function isToolsUnsupported(err: unknown): boolean {
  if (!ProviderError.is(err)) return false;
  if (err.status !== 400 && err.status !== 404 && err.status !== 422) return false;
  return /tool|function.?call/i.test(err.message);
}

export async function streamChat(
  providerId: string,
  key: string,
  req: ChatRequest,
): Promise<ReadableStream<Uint8Array>> {
  const p = getProvider(providerId, req.endpoint, req.budget);

  // Fit the conversation to whichever is tighter: the model's window, or what
  // one request is allowed to cost. For Groq those differ by a factor of
  // sixteen, and using the window alone is what burns a minute of quota on a
  // single question. Room is left for the tool schemas sent alongside.
  const toolBudget = req.tools?.length
    ? estimateTokens(JSON.stringify(req.tools))
    : 0;
  const ceiling = Math.min(p.maxContextTokens, p.maxRequestTokens ?? Infinity);
  const budget = Math.max(1000, ceiling - toolBudget);

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

  // The deadline covers connecting and thinking, and is cleared as soon as
  // the stream opens so a slow generation is never cut short.
  const guard = deadline(req.signal, p.firstByteTimeoutMs);

  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(key),
      signal: guard.signal,
      body: JSON.stringify(body),
    });
  } catch (err) {
    toNetworkError(err, p.label, p.baseUrl, guard.expired());
  } finally {
    guard.done();
  }

  if (!res.ok) throw await toProviderError(res, p.label);
  if (!res.body) throw new ProviderError(`${p.label} returned an empty stream.`, 502, true);

  return res.body;
}
