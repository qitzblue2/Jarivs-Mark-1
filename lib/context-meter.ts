import { estimateTokens } from "@/lib/tokens";
import { MAX_IMAGES, MAX_TEXT_CHARS } from "@/lib/attachments";
import type { Message } from "@/lib/types";

/**
 * How full the model's window is, in the browser, before you send.
 *
 * What it measures against is not the model's advertised window but what JARVIS
 * will actually send: the server trims the conversation to the smaller of the
 * window and the per-request budget (see lib/providers/openai-compat.ts), and for
 * a free tier those differ by a factor of sixteen. Past that line the oldest
 * turns are simply left out of the request — which is the thing worth seeing
 * coming, because the model then answers as if they never happened.
 *
 * Everything here is an estimate (four characters a token, the same one the
 * server trims with). Memory notes the server adds are not counted.
 */

/** A picture costs about this much; the server uses the same stand-in. */
export const IMAGE_TOKENS = 2048;

/** Framing the provider adds around each message. */
const PER_MESSAGE = 4;

/** Tokens in a conversation as it will be sent: words, attached text, and attached pictures still carrying their bytes. */
export function conversationTokens(messages: Pick<Message, "content" | "attachments">[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateTokens(message.content) + PER_MESSAGE;
    let images = 0;
    for (const a of message.attachments ?? []) {
      if (a.kind === "image") {
        // Older pictures are lightened to a name before they are stored; only
        // ones still holding their data are sent.
        if (a.dataUrl && images++ < MAX_IMAGES) total += IMAGE_TOKENS;
      } else {
        total += Math.ceil(Math.min(a.text?.length ?? 0, MAX_TEXT_CHARS) / 4) + 20;
      }
    }
  }
  return total;
}

interface ProviderSizes {
  maxContextTokens: number;
  maxRequestTokens?: number;
  customEndpoint?: boolean;
}

/**
 * The most a request may hold for this provider — the same arithmetic as
 * `getProvider` in lib/providers/registry.ts (a test holds them together).
 * `/api/models` reports each provider's sizes with the operator's environment
 * already applied; this adds what Settings can change for a slot you may repoint.
 */
export function contextCeiling(p: ProviderSizes, budget?: { context?: number }): number {
  const asked = p.customEndpoint && typeof budget?.context === "number" && Number.isFinite(budget.context) ? Math.round(budget.context) : null;
  const custom = asked !== null && asked >= 512 ? Math.min(asked, 200_000) : null;
  const context = custom ?? p.maxContextTokens;
  const request = p.maxRequestTokens ? (custom ? Math.max(512, Math.round(context * 0.85)) : p.maxRequestTokens) : undefined;
  return Math.min(context, request ?? Infinity);
}

export interface ContextInfo {
  /** Estimated tokens in the next request: instructions, tool list and conversation. */
  used: number;
  /** What the request may hold. */
  limit: number;
  ratio: number;
  level: "ok" | "warn" | "full";
  /** The conversation alone no longer fits, so the oldest turns are being left out. */
  leftOut: boolean;
}

export const WARN_AT = 0.7;

export function measureContext(input: {
  messages: Pick<Message, "content" | "attachments">[];
  /** The system prompt in force — a chat's own instructions, or Settings'. */
  persona: string;
  limit: number;
  /** The tool list's size, if tools are on. */
  toolTokens: number;
  useTools: boolean;
  /** The environment note the server adds when computer access is on. */
  noteTokens: number;
}): ContextInfo {
  const fixed = estimateTokens(input.persona) + input.noteTokens + PER_MESSAGE + (input.useTools ? input.toolTokens : 0);
  const used = fixed + conversationTokens(input.messages);
  const ratio = input.limit > 0 ? used / input.limit : 0;
  return {
    used,
    limit: input.limit,
    ratio,
    level: ratio >= 1 ? "full" : ratio >= WARN_AT ? "warn" : "ok",
    leftOut: ratio >= 1,
  };
}

/** 850 → "850", 2,400 → "2.4k", 12,300 → "12k". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}
