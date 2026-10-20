import { splitReasoning } from "@/lib/reasoning";
import type { Chat } from "@/lib/types";

/**
 * What the conversations add up to: how many, how long, what was reached for,
 * and when. Computed from the chats themselves on request — nothing is kept
 * about you that isn't already in the chats.
 */

export interface ChatStats {
  chats: { total: number; archived: number; pinned: number };
  messages: { total: number; user: number; assistant: number };
  words: { user: number; assistant: number };
  /** The last `days` calendar days ending today, oldest first, zeros included. */
  perDay: { day: string; messages: number }[];
  busiest: { day: string; messages: number } | null;
  tools: { name: string; calls: number; errors: number }[];
  models: { model: string; replies: number }[];
  firstMessageAt: number | null;
  /** 👍 and 👎 you gave to replies. */
  reactions: { up: number; down: number };
  /** How fast each model has answered here, fastest first. Tokens are estimated from length. */
  speeds: { model: string; replies: number; tokensPerSecond: number; firstTokenMs: number }[];
  /** The latest tool calls, newest first. */
  recentTools: { name: string; isError: boolean; ms: number; at: number; chatId: string; chatTitle: string }[];
}

export const MAX_RECENT_TOOLS = 15;

export const MAX_DAYS = 90;

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** The calendar day a moment falls on for someone `offsetMinutes` behind UTC (what `getTimezoneOffset()` reports). */
export function dayKey(at: number, offsetMinutes: number): string {
  return new Date(at - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function computeChatStats(
  chats: Chat[],
  { now = Date.now(), offsetMinutes = 0, days = 30 }: { now?: number; offsetMinutes?: number; days?: number } = {},
): ChatStats {
  const span = Math.min(MAX_DAYS, Math.max(1, Math.floor(days)));

  const perDay = new Map<string, number>();
  for (let i = span - 1; i >= 0; i--) perDay.set(dayKey(now - i * 86_400_000, offsetMinutes), 0);

  const stats: ChatStats = {
    chats: { total: chats.length, archived: 0, pinned: 0 },
    messages: { total: 0, user: 0, assistant: 0 },
    words: { user: 0, assistant: 0 },
    perDay: [],
    busiest: null,
    tools: [],
    models: [],
    firstMessageAt: null,
    reactions: { up: 0, down: 0 },
    speeds: [],
    recentTools: [],
  };
  const speed = new Map<string, { replies: number; tokens: number; ms: number; first: number }>();
  const tools = new Map<string, { calls: number; errors: number }>();
  const models = new Map<string, number>();

  for (const chat of chats) {
    if (chat.archived) stats.chats.archived++;
    if (chat.pinned) stats.chats.pinned++;
    for (const message of chat.messages) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      stats.messages.total++;
      if (stats.firstMessageAt === null || message.createdAt < stats.firstMessageAt) stats.firstMessageAt = message.createdAt;

      const key = dayKey(message.createdAt, offsetMinutes);
      if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1);

      if (message.role === "user") {
        stats.messages.user++;
        stats.words.user += countWords(message.content);
        continue;
      }

      stats.messages.assistant++;
      // The words you read, not a thinking model's hidden working-out.
      stats.words.assistant += countWords(splitReasoning(message.content).answer);
      if (message.model) models.set(message.model, (models.get(message.model) ?? 0) + 1);
      if (message.reaction === "up") stats.reactions.up++;
      else if (message.reaction === "down") stats.reactions.down++;
      if (message.model && message.stats && message.stats.totalMs > 0 && message.stats.tokens > 0) {
        const s = speed.get(message.model) ?? { replies: 0, tokens: 0, ms: 0, first: 0 };
        // Speed is how fast words arrived once they started: the wait for the first one is a separate number.
        const streaming = message.stats.totalMs - message.stats.firstTokenMs;
        s.replies++;
        s.tokens += message.stats.tokens;
        s.ms += streaming >= 200 ? streaming : message.stats.totalMs;
        s.first += message.stats.firstTokenMs;
        speed.set(message.model, s);
      }
      for (const round of message.toolRounds ?? []) {
        for (const call of round.calls) {
          const entry = tools.get(call.name) ?? { calls: 0, errors: 0 };
          entry.calls++;
          tools.set(call.name, entry);
        }
        for (const result of round.results) {
          stats.recentTools.push({ name: result.name, isError: result.isError, ms: result.ms, at: message.createdAt, chatId: chat.id, chatTitle: chat.title });
          if (!result.isError) continue;
          const entry = tools.get(result.name) ?? { calls: 0, errors: 0 };
          entry.errors++;
          tools.set(result.name, entry);
        }
      }
    }
  }

  stats.perDay = [...perDay.entries()].map(([day, messages]) => ({ day, messages }));
  stats.busiest = stats.perDay.reduce<ChatStats["busiest"]>(
    (best, d) => (d.messages > (best?.messages ?? 0) ? d : best),
    null,
  );
  stats.tools = [...tools.entries()]
    .map(([name, t]) => ({ name, ...t }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  stats.recentTools = stats.recentTools.sort((a, b) => b.at - a.at).slice(0, MAX_RECENT_TOOLS);
  stats.speeds = [...speed.entries()]
    .map(([model, s]) => ({ model, replies: s.replies, tokensPerSecond: Math.round((s.tokens / (s.ms / 1000)) * 10) / 10, firstTokenMs: Math.round(s.first / s.replies) }))
    .sort((a, b) => b.tokensPerSecond - a.tokensPerSecond || a.model.localeCompare(b.model));
  stats.models = [...models.entries()]
    .map(([model, replies]) => ({ model, replies }))
    .sort((a, b) => b.replies - a.replies || a.model.localeCompare(b.model))
    .slice(0, 8);
  return stats;
}
