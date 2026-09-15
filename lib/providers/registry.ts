import type { ProviderConfig } from "./types";

/**
 * Every provider here speaks the OpenAI wire format, so they all share
 * lib/providers/openai-compat.ts. Adding OpenRouter, Gemini (via its compat
 * endpoint), or a local Ollama is a new entry in this object — nothing else.
 */
export const PROVIDERS: Record<string, ProviderConfig> = {
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    signupUrl: "https://console.groq.com/keys",
    maxContextTokens: 96_000,
    // 6,000 tokens/minute on the free tier. Input and output both count, so
    // these two together have to fit inside it with room for a tool round.
    maxRequestTokens: 3500,
    maxOutputTokens: 2048,
    note: "Free, no card. Very fast. ~6K tokens/min, so replies stay brief.",
    // qwen3.6-27b takes text and images: max 3 images, 2048 tokens each,
    // and only 1,000 requests/day on the free tier.
    visionModels: ["qwen3.6", "qwen3.8", "vision", "llava", "scout", "maverick"],
  },
  /**
   * Google AI Studio, through its OpenAI-compatible endpoint.
   *
   * The reason it is here: Groq allows 6,000 tokens a minute and this allows
   * 250,000. That is the difference between a rate limit you hit every few
   * questions and one you will not meet. Function calling survives the
   * compatibility layer, so the agent loop works unchanged.
   *
   * Placed above Cerebras in the fallback order despite Cerebras being
   * faster: an 8K window truncates a long conversation badly, and this one
   * does not.
   *
   * Free tier means Google may use the conversation to improve its products,
   * which is worth knowing for an assistant that remembers things about you.
   */
  gemini: {
    id: "gemini",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    signupUrl: "https://aistudio.google.com/apikey",
    // 1M is offered; there is no reason to ever send that much.
    maxContextTokens: 32_000,
    // 250K/min at the 10 req/min cap is 25,000 per request, and the reply
    // counts toward it too — so input plus output has to fit inside that.
    maxRequestTokens: 20_000,
    maxOutputTokens: 4096,
    note: "Free, no card. 250K tokens/min — by far the most headroom.",
    visionModels: ["gemini"],
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
    signupUrl: "https://cloud.cerebras.ai",
    // Free tier hard-caps context at 8192 tokens. Leave room for the reply.
    maxContextTokens: 7000,
    // 1M tokens/day, and no per-minute squeeze worth planning around — the
    // 8K window is the binding constraint here, not the quota.
    maxRequestTokens: 6000,
    maxOutputTokens: 1024,
    note: "Free, no card. 1M tokens/day. Fastest, but 8K context.",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    signupUrl: "https://console.mistral.ai/api-keys",
    maxContextTokens: 32_000,
    // Mistral stopped publishing exact free-tier rates, so this is a
    // deliberate guess against a ~1B token monthly cap. Tune it if you meet
    // a 429 that this should have avoided.
    maxRequestTokens: 16_000,
    maxOutputTokens: 2048,
    note: "Free, no card. Roughly 1B tokens a month.",
  },
  /**
   * One key, hundreds of models, including free variants.
   *
   * The budget is conservative because "OpenRouter" is not one model — the
   * window depends entirely on which you pick, and guessing high truncates
   * nothing but costs a 400 from whichever model is smallest.
   */
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    signupUrl: "https://openrouter.ai/keys",
    maxContextTokens: 16_000,
    maxRequestTokens: 12_000,
    maxOutputTokens: 2048,
    // One tool-using turn is up to five requests, so the free tier is ten
    // turns a day. A way to reach a specific model, not a workhorse.
    note: "50 requests/day free; 1,000 after a one-off $10 credit.",
  },
  /**
   * Your own machine, via Ollama or llama.cpp's server.
   *
   * Last on purpose: it is the only provider that never rate-limits, and the
   * slowest by two orders of magnitude, which makes it exactly right as a
   * backstop and wrong as a first choice. The defaults below are deliberately
   * small — Ollama serves most models with a 4K window unless told otherwise,
   * and overrunning it truncates the conversation silently rather than
   * erroring.
   */
  local: {
    id: "local",
    label: "Self-hosted",
    baseUrl: "http://127.0.0.1:11434/v1",
    envKey: "JARVIS_LOCAL_API_KEY",
    requiresKey: false,
    allowCustomEndpoint: true,
    signupUrl: "https://ollama.com/download",
    maxContextTokens: 3500,
    // No quota to respect, but prefill on a CPU costs real seconds per
    // thousand tokens, so a short prompt is a fast first word.
    maxRequestTokens: 3000,
    maxOutputTokens: 1024,
    probeTimeoutMs: 3000,
    // Generous: a cold Ollama loads the weights from disk before it can even
    // start, and prefill on a CPU is slow the first time through a prompt.
    firstByteTimeoutMs: 90_000,
    note: "Any OpenAI-compatible URL — Ollama at home, or a host you rent.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/**
 * Per-provider environment overrides, e.g. JARVIS_LOCAL_BASE_URL.
 *
 * Provider ids must stay `[A-Z0-9_]`-safe when uppercased, since the variable
 * name is built from the id — an id with a dash would produce a name no shell
 * can set.
 */
function envFor(id: string, suffix: string): string | undefined {
  return process.env[`JARVIS_${id.toUpperCase()}_${suffix}`];
}

function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Accept a URL typed into Settings, or reject it.
 *
 * Deliberately strict about two things. Only http and https, because every
 * other scheme reaching a server-side fetch is someone probing rather than
 * configuring. And no embedded `user:pass@`, which browsers strip from
 * display but fetch still sends — a credential hidden in a URL is not a
 * credential anyone meant to store in localStorage.
 */
export function sanitizeEndpoint(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

/**
 * Where a provider's requests actually go, and who decided.
 *
 * The operator's environment always wins over the browser. That ordering is
 * the safety property: on a JARVIS reachable through a tunnel, a pinned
 * endpoint cannot be moved by whoever holds the password.
 */
export function resolveEndpoint(
  id: string,
  clientUrl?: string | null,
): { baseUrl: string; fromClient: boolean; locked: boolean } {
  const p = PROVIDERS[id];
  const fallback = p?.baseUrl ?? "";

  const fromEnv = envFor(id, "BASE_URL");
  if (fromEnv) return { baseUrl: fromEnv.replace(/\/+$/, ""), fromClient: false, locked: true };

  if (p?.allowCustomEndpoint) {
    const custom = sanitizeEndpoint(clientUrl);
    if (custom) return { baseUrl: custom, fromClient: true, locked: false };
  }

  return { baseUrl: fallback.replace(/\/+$/, ""), fromClient: false, locked: false };
}

/** Sizes a browser may set for a slot it is allowed to point somewhere. */
export interface EndpointBudget {
  context?: number;
  maxOutput?: number;
}

/**
 * Clamped, because these arrive from a text box.
 *
 * The upper bound is not about safety — it is that an enormous context makes
 * every request enormous, which is the exact failure this whole budget system
 * was built to stop.
 */
function clamp(value: number | undefined, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < min) return null;
  return Math.min(rounded, max);
}

export function getProvider(
  id: string,
  clientUrl?: string | null,
  budget?: EndpointBudget,
): ProviderConfig {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);

  // Only a slot the browser may repoint may also be resized by it. A budget
  // is far less dangerous than a URL, but one rule is easier to hold than two.
  const custom = p.allowCustomEndpoint ? budget : undefined;
  const customContext = clamp(custom?.context, 512, 200_000);
  const customOutput = clamp(custom?.maxOutput, 128, 32_000);

  // The environment outranks the browser here exactly as it does for the URL.
  const context = numberFrom(envFor(id, "CONTEXT"), customContext ?? p.maxContextTokens);
  const maxOutput = numberFrom(envFor(id, "MAX_TOKENS"), customOutput ?? p.maxOutputTokens);

  return {
    ...p,
    baseUrl: resolveEndpoint(id, clientUrl).baseUrl,
    // Context sizing is guesswork for a self-hosted endpoint — it depends on
    // the model and the num_ctx it was loaded with, which only you know.
    maxContextTokens: context,
    // A resized slot gets its request budget resized with it, or raising the
    // context would do nothing: the smaller of the two always binds.
    maxRequestTokens: p.maxRequestTokens
      ? numberFrom(
          envFor(id, "REQUEST_TOKENS"),
          customContext ? Math.max(512, Math.round(context * 0.85)) : p.maxRequestTokens,
        )
      : undefined,
    maxOutputTokens: maxOutput,
  };
}

/**
 * Pin the model a provider uses when the caller didn't name one.
 *
 * Matters for a local server: the automatic choice is whatever sorts first
 * alphabetically, which on a machine with several models pulled is a coin
 * toss between the one you wanted and an embedding model.
 */
export function preferredModel(id: string): string | null {
  return envFor(id, "MODEL") || null;
}

/** True when this model can accept image input. */
export function supportsVision(providerId: string, model: string): boolean {
  const patterns = PROVIDERS[providerId]?.visionModels;
  if (!patterns || patterns.length === 0) return false;
  const id = model.toLowerCase();
  return patterns.some((pattern) => id.includes(pattern.toLowerCase()));
}

export function defaultProviderId(): string {
  const configured = process.env.JARVIS_DEFAULT_PROVIDER;
  if (configured && PROVIDERS[configured]) return configured;
  // Prefer a provider with a real key: the local slot needs no key, so
  // without this it would win by default and every answer would arrive at
  // CPU speed.
  const withKey = PROVIDER_IDS.find((id) => hasServerKey(id) && requiresKey(id));
  if (withKey) return withKey;
  // Nothing configured but a local server is still a working JARVIS.
  return PROVIDER_IDS.find((id) => !requiresKey(id)) ?? "groq";
}

/** True when a key for this provider is present in the server environment. */
export function hasServerKey(id: string): boolean {
  const p = PROVIDERS[id];
  return Boolean(p && process.env[p.envKey]);
}

/** False for a local server, which authenticates nobody. */
export function requiresKey(id: string): boolean {
  return PROVIDERS[id]?.requiresKey !== false;
}

/**
 * Could this provider serve a request right now?
 *
 * Deliberately separate from `resolveKey`. Everything used to gate on the key
 * being truthy, which silently excluded a provider that needs no key — it was
 * never offered, never fell back to, and never listed, despite working. Note
 * this asks about configuration, not reachability: a local server that is
 * switched off still counts as ready here and fails later with a message that
 * says so.
 */
export function providerReady(
  id: string,
  clientKey?: string | null,
  clientEndpoint?: string | null,
): boolean {
  if (!PROVIDERS[id]) return false;
  if (!requiresKey(id)) return true;
  return resolveKey(id, clientKey, resolveEndpoint(id, clientEndpoint).fromClient) !== null;
}

/**
 * Resolve the key for a request: the server environment wins, and a
 * client-supplied key (Settings → bring your own key) is the fallback so a
 * deployed instance is usable without baking secrets into it.
 */
export function resolveKey(
  id: string,
  clientKey?: string | null,
  endpointFromClient = false,
): string | null {
  const p = PROVIDERS[id];
  if (!p) return null;

  // A browser-chosen endpoint never receives the server's key. Without this,
  // pointing a slot at your own server and reading the Authorization header
  // off the request is a one-step key exfiltration.
  if (endpointFromClient) return clientKey || null;

  return process.env[p.envKey] || clientKey || null;
}

/**
 * Has this install been set up at all?
 *
 * Asks whether any provider that NEEDS a key has one — deliberately not
 * "can anything answer". The self-hosted slot needs no key and so is always
 * ready, which would make every fresh clone look configured and turn the
 * first message into an error about a server the user has never heard of.
 *
 * Someone running Ollama with no cloud keys is set up correctly and must not
 * be told otherwise, so this is only ever used to explain a failure, never to
 * refuse an attempt.
 */
export function anyProviderConfigured(clientKeys: Record<string, string> = {}): boolean {
  return PROVIDER_IDS.some((id) => requiresKey(id) && resolveKey(id, clientKeys[id]));
}

/**
 * Which providers to try, in order, for one request.
 *
 * The chosen provider goes first even when it is the slow local one — an
 * explicit choice is not something to second-guess. After that, keyed cloud
 * providers before keyless local ones: the cloud is a hundred times faster,
 * and the local server's whole job is to still be there when the free tiers
 * have run out for the minute.
 *
 * Stated as a function rather than left to the order of keys in the object
 * above, which is invisible, load-bearing, and one reformat away from
 * silently reversing.
 */
export function fallbackOrder(
  primary: string,
  clientKeys: Record<string, string> = {},
  clientEndpoints: Record<string, string> = {},
): string[] {
  const rest = PROVIDER_IDS.filter((id) => id !== primary).sort(
    (a, b) => Number(!requiresKey(a)) - Number(!requiresKey(b)),
  );
  return [primary, ...rest].filter((id) =>
    providerReady(id, clientKeys[id], clientEndpoints[id]),
  );
}
