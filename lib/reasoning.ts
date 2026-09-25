/**
 * Separating a thinking model's reasoning from its answer.
 *
 * Qwen3, DeepSeek-R1 distills and GLM all open a `<think>` block by default,
 * and several providers pass it through inline in `content` rather than in a
 * separate field. Untouched, that reasoning is rendered as literal text and —
 * far worse — read aloud in voice mode, so JARVIS narrates a page of "the
 * user is asking about…" before answering the question.
 *
 * Kept pure so the streaming edges are testable: the interesting cases are
 * all partial, because a reply arrives token by token and is displayed and
 * spoken while the block is still open.
 */

/** `<think>`, `<thinking>` and `<reasoning>` all appear in the wild. */
const OPEN = /<(think|thinking|reasoning)>/i;
const CLOSED = /<(think|thinking|reasoning)>([\s\S]*?)<\/\1>/gi;

export interface Split {
  /** The model's reasoning, if it showed any. */
  reasoning: string;
  /** What it actually said — safe to display and to speak. */
  answer: string;
  /** True while a block is open and the answer has not started. */
  thinking: boolean;
}

export function splitReasoning(text: string): Split {
  const parts: string[] = [];

  // Completed blocks first, wherever they appear.
  let answer = text.replace(CLOSED, (_match, _tag, inner: string) => {
    parts.push(inner.trim());
    return "";
  });

  /**
   * An unterminated block means the model is still thinking.
   *
   * Everything after the opening tag is reasoning-so-far and must not be
   * shown or spoken — the closing tag may be hundreds of tokens away, and
   * speech starts on the first complete sentence.
   */
  const open = answer.search(OPEN);
  let thinking = false;
  if (open !== -1) {
    const after = answer.slice(open).replace(OPEN, "");
    if (after.trim()) parts.push(after.trim());
    answer = answer.slice(0, open);
    thinking = true;
  }

  return {
    reasoning: parts.join("\n\n").trim(),
    answer: answer.trim(),
    thinking,
  };
}

/** Just the speakable, displayable part. */
export function withoutReasoning(text: string): string {
  return splitReasoning(text).answer;
}
