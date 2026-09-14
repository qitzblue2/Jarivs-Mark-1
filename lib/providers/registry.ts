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
  github: {
    id: "github",
    label: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    envKey: "GITHUB_MODELS_TOKEN",
    signupUrl: "https://github.com/settings/personal-access-tokens",
    maxContextTokens: 6000,
    // Limited per request rather than per minute, so only the window binds.
    maxRequestTokens: 5000,
    maxOutputTokens: 4096,
    note: "Free with a GitHub account (13+). Slower: ~10 req/min.",
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
    label: "Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    envKey: "JARVIS_LOCAL_API_KEY",
    requiresKey: false,
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
    note: "Your own hardware. Never runs out, but far slower than the cloud.",
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

export function getProvider(id: string): ProviderConfig {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);

  return {
    ...p,
    baseUrl: (envFor(id, "BASE_URL") || p.baseUrl).replace(/\/+$/, ""),
    // Context sizing is guesswork for a local server — it depends entirely on
    // the model and the num_ctx it was loaded with, which only you know.
    maxContextTokens: numberFrom(envFor(id, "CONTEXT"), p.maxContextTokens),
    maxRequestTokens: p.maxRequestTokens
      ? numberFrom(envFor(id, "REQUEST_TOKENS"), p.maxRequestTokens)
      : undefined,
    maxOutputTokens: numberFrom(envFor(id, "MAX_TOKENS"), p.maxOutputTokens),
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
export function providerReady(id: string, clientKey?: string | null): boolean {
  if (!PROVIDERS[id]) return false;
  if (!requiresKey(id)) return true;
  return resolveKey(id, clientKey) !== null;
}

/**
 * Resolve the key for a request: the server environment wins, and a
 * client-supplied key (Settings → bring your own key) is the fallback so a
 * deployed instance is usable without baking secrets into it.
 */
export function resolveKey(id: string, clientKey?: string | null): string | null {
  const p = PROVIDERS[id];
  if (!p) return null;
  return process.env[p.envKey] || clientKey || null;
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
export function fallbackOrder(primary: string, clientKeys: Record<string, string> = {}): string[] {
  const rest = PROVIDER_IDS.filter((id) => id !== primary).sort(
    (a, b) => Number(!requiresKey(a)) - Number(!requiresKey(b)),
  );
  return [primary, ...rest].filter((id) => providerReady(id, clientKeys[id]));
}
