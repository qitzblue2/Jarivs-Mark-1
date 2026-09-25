/**
 * Incremental sentence splitting for streamed speech.
 *
 * Speech is synthesised a sentence at a time so it can start before the model
 * has finished writing, and so no single utterance is long enough to hit the
 * engine limits that were silently dropping long replies.
 *
 * The splitter is fed tokens as they arrive and only releases a chunk once it
 * is certain the sentence has ended — a `.` after "Dr" or inside "3.14" is not
 * the end of anything.
 */

/** Abbreviations whose trailing dot never ends a sentence. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "eg",
  "ie", "approx", "dept", "est", "fig", "no", "vol", "inc", "ltd", "co", "corp",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun", "am", "pm", "ca", "cf", "al",
]);

/** Long enough to be worth speaking; short enough to stay responsive. */
const MIN_CHUNK = 24;
const MAX_CHUNK = 240;

function endsWithAbbreviation(text: string): boolean {
  const match = /(?:^|[\s("'])([A-Za-z]{1,6})\.$/.exec(text);
  return match ? ABBREVIATIONS.has(match[1].toLowerCase()) : false;
}

/**
 * Is the terminator at `index` a real sentence end?
 *
 * Guards the three cases that produce nonsense chunks: decimals (3.14),
 * abbreviations (Dr.), and ellipses, which should break once rather than
 * three times.
 */
function isSentenceEnd(text: string, index: number): boolean {
  const char = text[index];
  if (char !== "." && char !== "!" && char !== "?") return false;

  // Inside a number: 3.14
  if (char === "." && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "")) {
    return false;
  }

  // Mid-ellipsis — only the last dot may terminate.
  if (char === "." && text[index + 1] === ".") return false;

  if (endsWithAbbreviation(text.slice(0, index + 1))) return false;

  // A terminator must be followed by whitespace, a closing mark, or the end.
  const after = text.slice(index + 1);
  if (after.length === 0) return true;
  return /^["'”’)\]]*(\s|$)/.test(after);
}

/**
 * Accumulates streamed text and emits complete sentences.
 *
 * Anything still buffered when the stream ends is released by `flush()`, so a
 * reply that never terminates its final sentence is still spoken.
 */
export class SentenceSplitter {
  private buffer = "";

  /** Feed newly generated text; returns any chunks now ready to speak. */
  push(text: string): string[] {
    this.buffer += text;
    const chunks: string[] = [];

    for (;;) {
      const chunk = this.takeNext();
      if (!chunk) break;
      chunks.push(chunk);
    }

    return chunks;
  }

  private takeNext(): string | null {
    for (let i = 0; i < this.buffer.length; i++) {
      if (!isSentenceEnd(this.buffer, i)) continue;

      // Include trailing quotes/brackets that belong to this sentence.
      let end = i + 1;
      while (end < this.buffer.length && /["'”’)\]]/.test(this.buffer[end])) end++;

      const candidate = this.buffer.slice(0, end).trim();
      // Too short to be worth a separate utterance — keep accumulating.
      if (candidate.length < MIN_CHUNK && this.buffer.length < MAX_CHUNK) continue;

      this.buffer = this.buffer.slice(end);
      return candidate;
    }

    // No terminator in sight but the buffer is getting long — break at the
    // last clause boundary so speech doesn't stall on a run-on sentence.
    if (this.buffer.length >= MAX_CHUNK) {
      const window = this.buffer.slice(0, MAX_CHUNK);
      const cut = Math.max(
        window.lastIndexOf(", "),
        window.lastIndexOf("; "),
        window.lastIndexOf(" — "),
        window.lastIndexOf(": "),
      );
      const at = cut > MIN_CHUNK ? cut + 1 : window.lastIndexOf(" ");
      if (at > MIN_CHUNK) {
        const chunk = this.buffer.slice(0, at).trim();
        this.buffer = this.buffer.slice(at);
        return chunk;
      }
    }

    return null;
  }

  /** Release whatever is left, at end of stream. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }

  get pending(): string {
    return this.buffer;
  }

  reset(): void {
    this.buffer = "";
  }
}

/** Split a complete string — the non-streaming path, used for the greeting. */
export function splitSentences(text: string): string[] {
  const splitter = new SentenceSplitter();
  return [...splitter.push(text), ...splitter.flush()];
}
