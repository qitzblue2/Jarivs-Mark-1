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
  /**
   * Models on this provider that accept images, matched as substrings.
   * Empty means no vision support.
   */
  visionModels?: string[];
}

/** Minimal message shape sent upstream. */
/** OpenAI multimodal content part. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface WireMessage {
  role: Role;
  /** A parts array is used only when a turn carries images. */
  content: string | ContentPart[];
  /** Assistant turns that requested tools. */
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  /** Required on `tool` messages, tying the result to its call. */
  tool_call_id?: string;
  /** Tool messages carry the tool name too, for providers that want it. */
  name?: string;
}

export interface ChatRequest {
  messages: WireMessage[];
  model: string;
  temperature?: number;
  signal?: AbortSignal;
  /** OpenAI-shaped tool definitions. Omitted entirely when empty. */
  tools?: unknown[];
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
