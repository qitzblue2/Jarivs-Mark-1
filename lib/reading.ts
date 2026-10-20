import { splitReasoning } from "@/lib/reasoning";

/**
 * Helpers for reading a conversation: finding words in it, a list of what you
 * asked, jumping between your messages, quoting one, copying a reply as plain
 * words, and how long a reply takes to read.
 *
 * All pure and about strings. The page does the walking of text nodes and the
 * scrolling; what is matched, listed and measured is decided here, where it
 * can be tested.
 */

// --- find in a chat ----------------------------------------------------------

export interface Span {
  /** Which of the texts it is in. */
  node: number;
  start: number;
  end: number;
}

export const MAX_MATCHES = 500;

/**
 * Every place `query` appears in `texts`, in order, ignoring case, without
 * overlapping itself ("aa" in "aaa" is one match). An empty or all-space query
 * matches nothing: highlighting every gap would be noise.
 */
export function findSpans(texts: string[], query: string, limit = MAX_MATCHES): Span[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const spans: Span[] = [];
  for (let node = 0; node < texts.length; node++) {
    const hay = texts[node].toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at === -1) break;
      spans.push({ node, start: at, end: at + needle.length });
      if (spans.length >= limit) return spans;
      from = at + needle.length;
    }
  }
  return spans;
}

/** "3 of 12", "No matches", or "" with nothing typed. */
export function findLabel(query: string, current: number, total: number): string {
  if (!query.trim()) return "";
  if (total === 0) return "No matches";
  return `${current + 1} of ${total}${total >= MAX_MATCHES ? "+" : ""}`;
}

/** Step through matches, wrapping at either end. */
export function stepMatch(current: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + dir + total) % total;
}

// --- the outline ----------------------------------------------------------------

export interface OutlineItem {
  id: string;
  /** The first line of the question, trimmed and shortened. */
  preview: string;
  /** 1-based among your messages. */
  number: number;
}

const MAX_PREVIEW = 80;

/** Your questions, in order, each as one short line you can recognise it by. */
export function outlineOf(messages: { id: string; role: string; content: string; attachments?: { name: string }[] }[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    const line = m.content.split("\n").map((l) => l.trim()).find(Boolean);
    const text = line ?? (m.attachments?.length ? `📎 ${m.attachments[0].name}` : "(empty message)");
    out.push({
      id: m.id,
      preview: text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW - 1)}…` : text,
      number: out.length + 1,
    });
  }
  return out;
}

// --- jumping between your messages --------------------------------------------------

/**
 * Given where each of your messages sits relative to the top of the
 * conversation's viewport (negative: scrolled past), the one to go to. Going
 * up is the nearest one above the top edge; going down, the nearest below it.
 * `slack` is how far from the edge counts as "still here", so pressing the key
 * on a message that is already at the top moves on rather than staying put.
 * Null when there is nowhere to go.
 */
export function pickJump(tops: number[], dir: "up" | "down", slack = 8): number | null {
  if (dir === "up") {
    for (let i = tops.length - 1; i >= 0; i--) if (tops[i] < -slack) return i;
    return null;
  }
  for (let i = 0; i < tops.length; i++) if (tops[i] > slack) return i;
  return null;
}

// --- quoting --------------------------------------------------------------------------

export const MAX_QUOTE = 1200;

/**
 * A message as a Markdown quote to start a reply with: every line prefixed,
 * reasoning left out, long ones cut with an ellipsis. Ends with a blank line so
 * the cursor lands on a fresh line after it.
 */
export function quoteText(content: string, max = MAX_QUOTE): string {
  let body = splitReasoning(content).answer.trim() || content.trim();
  if (!body) return "";
  if (body.length > max) body = `${body.slice(0, max).trimEnd()}…`;
  return `${body.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}\n\n`;
}

/** Add a quote to what is already in the box, with a blank line between. */
export function appendQuote(draft: string, quote: string): string {
  if (!quote) return draft;
  const base = draft.replace(/\s+$/, "");
  return base ? `${base}\n\n${quote}` : quote;
}

// --- plain text ---------------------------------------------------------------------------

/**
 * Markdown as the words a person would type: no asterisks, hashes or fences,
 * links as "text (address)", code kept as it is. For pasting into an email or a
 * document that would show the markup literally.
 */
export function toPlainText(markdown: string): string {
  const fences: string[] = [];
  let text = markdown.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code: string) => {
    fences.push(code.replace(/\n$/, ""));
    return `\u0000${fences.length - 1}\u0000`;
  });

  text = text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt: string) => alt || "")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label: string, href: string) => (label === href ? href : `${label} (${href})`))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, "");

  text = text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => fences[Number(i)]);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

// --- reading time -------------------------------------------------------------------------------

const WORDS_PER_MINUTE = 220;
/** Below this a reply is a glance, and a count would be clutter. */
export const READING_LABEL_FROM = 120;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** "~2 min read · 450 words", or null for a short reply. Code fences don't count: nobody reads them at speaking pace. */
export function readingLabel(content: string): string | null {
  const answer = splitReasoning(content).answer.replace(/```[\s\S]*?```/g, " ");
  const words = countWords(answer);
  if (words < READING_LABEL_FROM) return null;
  return `~${readingMinutes(words)} min read · ${words.toLocaleString("en-US")} words`;
}
