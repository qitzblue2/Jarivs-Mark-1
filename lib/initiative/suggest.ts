/**
 * Two things JARVIS can offer without a model call: the next thing you might
 * ask, and a fact worth remembering.
 *
 * Both are looked for in text already on screen, by shape. A shape is a guess —
 * the follow-ups are buttons that put words in the message box, and the memory
 * offer saves nothing unless you press it — so a wrong guess costs one glance.
 */

export interface Suggestion {
  id: string;
  /** The button. */
  label: string;
  /** What goes into the message box. */
  text: string;
}

const MIN_ANSWER = 40;
const LONG_ANSWER = 1500;

const CODE = /```/;
const IMAGE = /!\[[^\]]*\]\(\/api\/images\/[0-9a-f-]{36}/;
const TABLE = /^\s*\|.+\|\s*\n\s*\|[\s:|-]+\|/m;
const STEPS = /(?:^|\n)\s*1\.\s.+\n\s*2\.\s.+\n\s*3\.\s/;

/**
 * Up to three follow-ups for a reply, most specific first. A reply that ends in
 * a question is JARVIS asking *you* something, and a row of buttons would be
 * talking over it, so it gets none.
 */
export function suggestFollowUps(answer: string, opts: { error?: boolean } = {}): Suggestion[] {
  const text = answer.trim();
  if (opts.error) {
    return [
      { id: "retry", label: "Try again", text: "Please try that again." },
      { id: "what-went-wrong", label: "What went wrong?", text: "What went wrong there, and what can we do about it?" },
    ];
  }
  if (text.length < MIN_ANSWER || /\?\s*$/.test(text)) return [];

  const out: Suggestion[] = [];
  const add = (s: Suggestion) => {
    if (out.length < 3 && !out.some((o) => o.id === s.id)) out.push(s);
  };

  if (IMAGE.test(text)) {
    add({ id: "night", label: "Make it night-time", text: "Make it night-time." });
    add({ id: "style", label: "Try a different style", text: "Try it in a completely different style." });
  }
  if (CODE.test(text)) {
    add({ id: "explain-code", label: "Explain how it works", text: "Explain how that code works, step by step." });
    add({ id: "errors", label: "Add error handling", text: "Add error handling to that." });
    add({ id: "tests", label: "Write tests for it", text: "Write tests for it." });
  }
  if (TABLE.test(text)) add({ id: "table", label: "Summarise the table", text: "Summarise that table in one sentence." });
  if (STEPS.test(text)) add({ id: "step-one", label: "Walk me through step 1", text: "Walk me through step 1 in more detail." });
  if (text.length > LONG_ANSWER) {
    add({ id: "shorter", label: "Shorter, please", text: "Shorter, please — just the key points." });
  }

  add({ id: "deeper", label: "Go deeper", text: "Go deeper on that." });
  add({ id: "example", label: "Give me an example", text: "Give me a concrete example." });
  add({ id: "downsides", label: "What are the downsides?", text: "What are the downsides or risks?" });
  return out;
}

const MAX_LENGTH = 300;
const MAX_LINES = 3;
const CAPITAL_WORDS = "([A-Z][\\w&.'-]*(?: [A-Z][\\w&.'-]*){0,3})";

/**
 * A durable fact stated in a message — a name, an allergy, where you live or
 * work, a standing preference — as the sentence JARVIS would store, or null.
 *
 * Deliberately narrow: the model has its own `remember` tool for what it judges
 * worth keeping, and this only catches the clear first-person statements. A
 * hypothetical ("if I live in Oslo"), a question, code and long pastes are left
 * alone.
 */
export function detectFact(message: string): string | null {
  const text = message.trim();
  if (!text || text.length > MAX_LENGTH || text.split("\n").length > MAX_LINES || CODE.test(text)) return null;
  if (/^(if|when|whenever|suppose|imagine|what if)\b/i.test(text)) return null;
  if (/^(do|does|did|can|could|should|would|is|are|what|how|why|where|who)\b.*\?\s*$/i.test(text)) return null;

  const clean = (s: string) => s.replace(/[\s.,;!]+$/, "").trim();
  const sentence = text.split(/(?<=[.!?])\s+/).find((s) => /\b(my|i|i'm|i am|call me)\b/i.test(s)) ?? text;

  let m = /\b(?:my name is|call me)\s+(\S+)/i.exec(sentence);
  if (m) {
    const name = clean(m[1]);
    if (/^[A-Z][A-Za-z'-]{1,24}$/.test(name)) return `User's name is ${name}`;
  }

  m = /\bI(?:'m| am) allergic to\s+(.{2,60})/i.exec(sentence);
  if (m) return `User is allergic to ${clean(m[1])}`;

  m = /\bI(?:'m| am) (vegetarian|vegan|diabetic|left-handed|colou?r-?blind|pescatarian|gluten[- ]free|lactose intolerant)\b/i.exec(sentence);
  if (m) return `User is ${m[1].toLowerCase()}`;

  m = new RegExp(`\\b(I live in|I was born in|I am from|I'm from)\\s+${CAPITAL_WORDS}`).exec(sentence);
  if (m) return `User ${m[1] === "I live in" ? "lives in" : m[1] === "I was born in" ? "was born in" : "is from"} ${clean(m[2])}`;

  m = new RegExp(`\\bI work (?:at|for)\\s+${CAPITAL_WORDS}`).exec(sentence);
  if (m) return `User works at ${clean(m[1])}`;

  m = /\bI work as\s+(.{3,40})/i.exec(sentence);
  if (m) return `User works as ${clean(m[1])}`;

  m = /\bI (always|never) use\s+(.{2,50})/i.exec(sentence);
  if (m) return `User ${m[1].toLowerCase()} uses ${clean(m[2])}`;

  m = /\bI prefer\s+(.{2,60})/i.exec(sentence);
  if (m) return `User prefers ${clean(m[1])}`;

  m = /\bmy birthday is\s+(.{2,30})/i.exec(sentence);
  if (m) return `User's birthday is ${clean(m[1])}`;

  m = /\bmy pronouns are\s+([\w/ -]{2,20})/i.exec(sentence);
  if (m) return `User's pronouns are ${clean(m[1])}`;

  return null;
}
