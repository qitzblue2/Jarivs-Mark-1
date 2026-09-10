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
 *
 * Tool turns are trimmed as a unit: an assistant message carrying `tool_calls`
 * and the `tool` results answering it are kept or dropped together. Splitting
 * them leaves a tool result with no matching call, which providers reject with
 * a 400 — a worse outcome than dropping one more turn of history.
 */
export function trimToBudget<
  T extends { role: string; content: string; tool_calls?: unknown[] },
>(messages: T[], budget: number): { messages: T[]; dropped: number } {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");

  // Group each assistant-with-tool_calls together with the tool results after it.
  const groups: T[][] = [];
  for (const message of rest) {
    const previous = groups[groups.length - 1];
    const continuesToolGroup =
      message.role === "tool" &&
      previous &&
      (previous[0].role === "assistant" || previous[0].role === "tool");

    if (continuesToolGroup) previous.push(message);
    else groups.push([message]);
  }

  let used = estimateMessagesTokens(system);
  const kept: T[][] = [];

  // Walk backwards so the newest turns survive.
  for (let i = groups.length - 1; i >= 0; i--) {
    const cost = estimateMessagesTokens(groups[i]);
    // Always keep at least the latest group, even if it alone blows the budget.
    if (used + cost > budget && kept.length > 0) break;
    used += cost;
    kept.unshift(groups[i]);
  }

  const flat = kept.flat();

  // A leading orphan can still survive if the newest group itself starts with a
  // tool result; the provider would reject that, so shed them.
  while (flat.length > 1 && flat[0].role === "tool") flat.shift();

  return { messages: [...system, ...flat], dropped: rest.length - flat.length };
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
