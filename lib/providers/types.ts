import type { Role } from "@/lib/types";

/** A provider entry in the registry. */
export interface ProviderConfig {
  id: string;
  label: string;
  /** OpenAI-compatible base URL, no trailing slash. */
  baseUrl: string;
  /** Name of the environment variable holding the API key. */
  envKey: string;
  /** Where to get a free key, surfaced in the UI when the key is missing. */
  signupUrl: string;
  /**
   * Usable context window on the FREE tier, in tokens. Requests are trimmed to
   * fit — Cerebras' free tier hard-caps at 8K and errors past it.
   */
  maxContextTokens: number;
  /** Cap on generated tokens. */
  maxOutputTokens: number;
  /** Short note shown in the model picker. */
  note: string;
}

/** Minimal message shape sent upstream. */
export interface WireMessage {
  role: Role;
  content: string;
}

export interface ChatRequest {
  messages: WireMessage[];
  model: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ModelInfo {
  id: string;
  /** Provider that serves it — set by the registry, not the upstream API. */
  provider: string;
}

/** Thrown for upstream failures so routes can map them to useful HTTP codes. */
export class ProviderError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status: number, retryable = false) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = retryable;
  }
}
