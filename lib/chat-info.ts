import { splitReasoning } from "@/lib/reasoning";
import { conversationTokens } from "@/lib/context-meter";
import { countWords } from "@/lib/reading";
import type { Chat } from "@/lib/types";

/**
 * The facts of one conversation, worked out from the chat itself: how long, how
 * many words, which models answered, what tools ran, how it was rated. For the
 * Chat info panel; nothing here is kept anywhere else.
 */

export interface ChatInfo {
  messages: { user: number; assistant: number };
  /** Words you read: a thinking model's hidden reasoning isn't counted. */
  words: { user: number; assistant: number };
  /** What the conversation alone weighs, by the same estimate as the context meter. */
  tokens: number;
  models: { model: string; replies: number }[];
  tools: { calls: number; errors: number };
  reactions: { up: number; down: number };
  starred: number;
  attachments: number;
  firstAt: number | null;
  lastAt: number | null;
  /** How long between the first message and the last. */
  spanMs: number;
  /** The slowest reply, in ms, if any was timed. */
  slowestMs: number | null;
}

export function chatInfo(chat: Pick<Chat, "messages">): ChatInfo {
  const info: ChatInfo = {
    messages: { user: 0, assistant: 0 },
    words: { user: 0, assistant: 0 },
    tokens: conversationTokens(chat.messages.filter((m) => m.role === "user" || m.role === "assistant")),
    models: [],
    tools: { calls: 0, errors: 0 },
    reactions: { up: 0, down: 0 },
    starred: 0,
    attachments: 0,
    firstAt: null,
    lastAt: null,
    spanMs: 0,
    slowestMs: null,
  };
  const models = new Map<string, number>();
  for (const m of chat.messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (info.firstAt === null || m.createdAt < info.firstAt) info.firstAt = m.createdAt;
    if (info.lastAt === null || m.createdAt > info.lastAt) info.lastAt = m.createdAt;
    if (m.starred) info.starred++;
    info.attachments += m.attachments?.length ?? 0;
    if (m.role === "user") {
      info.messages.user++;
      info.words.user += countWords(m.content);
      continue;
    }
    info.messages.assistant++;
    info.words.assistant += countWords(splitReasoning(m.content).answer);
    if (m.model) models.set(m.model, (models.get(m.model) ?? 0) + 1);
    if (m.reaction === "up") info.reactions.up++;
    else if (m.reaction === "down") info.reactions.down++;
    if (m.stats && (info.slowestMs === null || m.stats.totalMs > info.slowestMs)) info.slowestMs = m.stats.totalMs;
    for (const round of m.toolRounds ?? []) {
      info.tools.calls += round.calls.length;
      info.tools.errors += round.results.filter((r) => r.isError).length;
    }
  }
  info.models = [...models.entries()].map(([model, replies]) => ({ model, replies })).sort((a, b) => b.replies - a.replies || a.model.localeCompare(b.model));
  info.spanMs = info.firstAt !== null && info.lastAt !== null ? info.lastAt - info.firstAt : 0;
  return info;
}

/** "3 minutes", "2 hours 5 minutes", "4 days" — a length of time in the two biggest units that matter. */
export function spanLabel(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return `${hours} hour${hours === 1 ? "" : "s"}${rest ? ` ${rest} minute${rest === 1 ? "" : "s"}` : ""}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
