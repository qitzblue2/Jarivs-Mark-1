import type { Role } from "@/lib/types";

/** A provider entry in the registry. */
export interface ProviderConfig {
  id: string;
  label: string;
  /** OpenAI-compatible base URL, no trailing slash. */
  baseUrl: string;
  /** Name of the environment variable holding the API key. */
  envKey: string;
  /**
   * False for a provider that needs no key at all — a local Ollama or
   * llama.cpp server on your own machine. Everything that gates on "is there
   * a key?" has to ask this first, or a keyless provider is silently dropped
   * from the fallback order despite being perfectly reachable.
   */
  requiresKey?: boolean;
  /**
   * May the browser point this slot at a URL of its own choosing?
   *
   * True only for the self-hosted slot. Allowing it everywhere would let
   * anyone with a session repoint the Groq slot at a server they control and
   * read the operator's API key straight out of the forwarded request.
   */
  allowCustomEndpoint?: boolean;
  /** Where to get a free key, surfaced in the UI when the key is missing. */
  signupUrl: string;
  /**
   * Usable context window on the FREE tier, in tokens. Requests are trimmed to
   * fit — Cerebras' free tier hard-caps at 8K and errors past it.
   */
  maxContextTokens: number;
  /**
   * Ceiling on ONE request, in tokens — set by the rate limit, not the
   * context window.
   *
   * These are different numbers and conflating them is what makes a free tier
   * feel broken. Groq's window is 96K but it allows 6K tokens per *minute*,
   * so trimming a long conversation to the window sends sixteen minutes of
   * quota in a single question and every answer after the first fails. The
   * agent loop makes up to five requests per turn, each carrying the whole
   * history again, which multiplies it.
   *
   * Smaller means JARVIS forgets earlier turns sooner. That is the trade, and
   * it is a better one than hard-failing.
   */
  maxRequestTokens?: number;
  /** Cap on generated tokens. Counts toward the rate limit too. */
  maxOutputTokens: number;
  /** Short note shown in the model picker. */
  note: string;
  /**
   * Models on this provider that accept images, matched as substrings.
   * Empty means no vision support.
   */
  visionModels?: string[];
  /**
   * How long to wait for the model list, in ms.
   *
   * This doubles as the reachability check for a server on your LAN. A host
   * that is powered off usually refuses fast, but one behind a firewall that
   * DROPs instead of rejecting will hold a TCP connect open for over two
   * minutes — long enough that a sleeping PC would appear to hang JARVIS.
   * Unset means wait indefinitely, which is right for a cloud provider.
   */
  probeTimeoutMs?: number;
  /**
   * How long to wait for a completion to START streaming, in ms.
   *
   * Cleared the moment headers arrive, so generation itself is never cut off
   * — a CPU model legitimately takes minutes to finish a long answer, and it
   * is only the silence before the first byte that indicates something is
   * wrong.
   */
  firstByteTimeoutMs?: number;
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
  /** Base URL chosen in Settings, for a slot that permits one. */
  endpoint?: string;
  /** Context and output sizes chosen in Settings, for the same slot. */
  budget?: { context?: number; maxOutput?: number };
}

export interface ModelInfo {
  id: string;
  /** Provider that serves it — set by the registry, not the upstream API. */
  provider: string;
}

/** Thrown for upstream failures so routes can map them to useful HTTP codes. */
export class ProviderError extends Error {
  /**
   * A brand, so recognising one never depends on class identity.
   *
   * `instanceof` compares the constructor object, not the shape, so it
   * quietly returns false whenever this module is evaluated twice — separate
   * bundler chunks, a test runner resolving the same file two ways. That
   * would be a footnote if the whole provider fallback did not hinge on it:
   * `retryable` is only consulted inside an `instanceof` branch, so a failed
   * check turns every rate limit into a hard error instead of rolling over
   * to the next provider. Observed happening under tsx, hence the brand.
   */
  readonly isProviderError = true;

  status: number;
  retryable: boolean;
  /** From a Retry-After header, when the provider sent one. */
  retryAfterMs?: number;

  constructor(message: string, status: number, retryable = false, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }

  /** Prefer this over `instanceof`. */
  static is(err: unknown): err is ProviderError {
    return (err as ProviderError | null)?.isProviderError === true;
  }
}
