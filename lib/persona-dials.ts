/**
 * Four dials that nudge how JARVIS speaks without rewriting its instructions:
 * how formal, how funny, how warm, how detailed. Each is 0–4 with 2 as
 * "leave it alone", so a fresh install adds nothing to the prompt.
 *
 * Like tone and reply length, the page sends numbers and the server holds the
 * words: nothing a page sends can put its own text into the system prompt this
 * way, and a dial left in the middle costs no tokens at all.
 */
export const DIALS = ["formality", "humour", "warmth", "detail"] as const;
export type Dial = (typeof DIALS)[number];
export type Dials = Record<Dial, number>;

export const NEUTRAL_DIALS: Dials = { formality: 2, humour: 2, warmth: 2, detail: 2 };

export const DIAL_INFO: Record<Dial, { label: string; low: string; high: string }> = {
  formality: { label: "Formality", low: "Casual", high: "Formal" },
  humour: { label: "Humour", low: "Serious", high: "Playful" },
  warmth: { label: "Warmth", low: "Matter-of-fact", high: "Warm" },
  detail: { label: "Detail", low: "Just the point", high: "Thorough" },
};

/** What each setting other than the middle one asks for. */
const WORDS: Record<Dial, [string, string, null, string, string]> = {
  formality: ["Write very casually, like a friend texting.", "Keep a relaxed, conversational register.", null, "Keep a professional, polished register.", "Write formally, as in a letter to a client."],
  humour: ["Stay completely serious; no jokes.", "Keep it mostly serious, with at most a light touch.", null, "Be lightly playful where the topic allows.", "Be openly playful and joke freely, while staying accurate."],
  warmth: ["Be brisk and impersonal; skip pleasantries.", "Stay matter-of-fact; keep encouragement minimal.", null, "Be friendly and encouraging.", "Be very warm and personal, acknowledging how the user may feel."],
  detail: ["Give only the bare answer.", "Be economical; one or two key points.", null, "Explain the reasoning behind answers.", "Be thorough: reasoning, edge cases and an example."],
};

/** Make a stored value valid, one dial at a time. Anything missing or wrong becomes the middle. */
export function cleanDials(raw: unknown): Dials {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...NEUTRAL_DIALS };
  for (const d of DIALS) {
    const v = r[d];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4) out[d] = v;
  }
  return out;
}

export const isNeutral = (d: Dials): boolean => DIALS.every((k) => d[k] === 2);

/** The guidance for these dials, or null when all are in the middle. */
export function dialsHint(raw: unknown): string | null {
  const d = cleanDials(raw);
  const lines = DIALS.map((k) => WORDS[k][d[k]]).filter((x): x is string => Boolean(x));
  return lines.length ? lines.join(" ") : null;
}

/** Named presets of the four dials. */
export const DIAL_MOODS: { id: string; label: string; dials: Dials }[] = [
  { id: "balanced", label: "Balanced", dials: NEUTRAL_DIALS },
  { id: "buddy", label: "Buddy", dials: { formality: 0, humour: 3, warmth: 4, detail: 2 } },
  { id: "professional", label: "Professional", dials: { formality: 4, humour: 0, warmth: 2, detail: 3 } },
  { id: "terse", label: "Terse", dials: { formality: 2, humour: 1, warmth: 1, detail: 0 } },
  { id: "mentor", label: "Mentor", dials: { formality: 2, humour: 2, warmth: 3, detail: 4 } },
];

export function moodOf(d: Dials): string | null {
  return DIAL_MOODS.find((m) => DIALS.every((k) => m.dials[k] === d[k]))?.id ?? null;
}

/** Your own saved personas: a name and the instructions. Cleaned wherever they arrive from. */
export interface CustomPersona {
  name: string;
  text: string;
}
export const MAX_CUSTOM_PERSONAS = 12;

export function cleanCustomPersonas(raw: unknown): CustomPersona[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomPersona[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { name, text } = item as Record<string, unknown>;
    if (typeof name !== "string" || typeof text !== "string") continue;
    const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
    const t = text.replace(/\r\n/g, "\n").trim().slice(0, 20_000);
    if (!n || !t || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push({ name: n, text: t });
    if (out.length >= MAX_CUSTOM_PERSONAS) break;
  }
  return out;
}
