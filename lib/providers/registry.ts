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
    maxOutputTokens: 8192,
    note: "Free, no card. ~30 req/min. Very fast, big context.",
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
    maxOutputTokens: 4096,
    note: "Free with a GitHub account (13+). Slower: ~10 req/min.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/**
 * Base URLs can be overridden per provider, e.g. JARVIS_GROQ_BASE_URL. Useful
 * for pointing a provider slot at a local Ollama / LM Studio server or a proxy.
 */
function baseUrlFor(p: ProviderConfig): string {
  const override = process.env[`JARVIS_${p.id.toUpperCase()}_BASE_URL`];
  return (override || p.baseUrl).replace(/\/+$/, "");
}

export function getProvider(id: string): ProviderConfig {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return { ...p, baseUrl: baseUrlFor(p) };
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
  // Otherwise prefer whichever provider actually has a key.
  const withKey = PROVIDER_IDS.find((id) => hasServerKey(id));
  return withKey ?? "groq";
}

/** True when a key for this provider is present in the server environment. */
export function hasServerKey(id: string): boolean {
  const p = PROVIDERS[id];
  return Boolean(p && process.env[p.envKey]);
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

/** Providers that could serve a request right now, primary first. */
export function availableProviders(clientKeys: Record<string, string> = {}): string[] {
  return PROVIDER_IDS.filter((id) => resolveKey(id, clientKeys[id]));
}
