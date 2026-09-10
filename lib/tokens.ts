/**
 * Cheap token estimation. Real tokenizers are per-model and cost a dependency
 * we don't need — ~4 characters per token is close enough to keep requests
 * inside a context window, which is all we use it for.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(
  messages: { role: string; content: string }[],
): number {
  // ~4 tokens of per-message framing overhead.
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

/**
 * Drop the oldest turns until the conversation fits `budget`, always keeping
 * the system prompt and the most recent message. Without this, Cerebras' free
 * tier starts rejecting requests once a chat passes 8K tokens.
 */
export function trimToBudget<T extends { role: string; content: string }>(
  messages: T[],
  budget: number,
): { messages: T[]; dropped: number } {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");

  let used = estimateMessagesTokens(system);
  const kept: T[] = [];

  // Walk backwards so the newest turns survive.
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateTokens(rest[i].content) + 4;
    // Always keep at least the latest message, even if it alone blows the budget.
    if (used + cost > budget && kept.length > 0) break;
    used += cost;
    kept.unshift(rest[i]);
  }

  return { messages: [...system, ...kept], dropped: rest.length - kept.length };
}

/**
 * Last-resort guard: a single message longer than the whole budget gets its
 * middle cut out rather than being rejected upstream.
 */
export function truncateMiddle(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2) - 40;
  return `${text.slice(0, half)}\n\n…[trimmed to fit the context window]…\n\n${text.slice(-half)}`;
}
