import { parseHhmm } from "./due";
import type { Schedule } from "./types";

/**
 * Ready-made things for JARVIS to do unprompted — a morning briefing and a few
 * others — so the Scheduled list doesn't start as an empty box that has to be
 * filled by asking in words.
 *
 * A template is a recipe, not a task: it produces the same prompt and schedule
 * anyone could have typed, and the result goes through the same `createTask`
 * validation. The prompts are written as instructions to JARVIS itself (that is
 * how a fired task receives them) and short, because they are usually read aloud.
 */

export interface TemplateField {
  id: string;
  label: string;
  placeholder: string;
  required?: boolean;
}

export interface TaskTemplate {
  id: string;
  name: string;
  blurb: string;
  /** When it runs unless changed. Daily at a time, or every so many minutes. */
  when: { kind: "daily"; hhmm: string } | { kind: "every"; minutes: number };
  fields?: TemplateField[];
  prompt: (values: Record<string, string>) => string;
  label: (values: Record<string, string>) => string;
  /** Shown beside the "every" ones: each firing spends a request. */
  costly?: boolean;
}

const BRIEF = "Keep it short — it is read aloud.";

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "morning-briefing",
    name: "Morning briefing",
    blurb: "The date, then the headlines.",
    when: { kind: "daily", hhmm: "08:00" },
    fields: [{ id: "topic", label: "Headlines about", placeholder: "anything — or technology, your city…" }],
    prompt: ({ topic }) =>
      "Give a good-morning briefing: today's date and the day of the week, then the three most important " +
      `news headlines${topic ? ` about ${topic}` : ""} (search the web), one sentence each. ${BRIEF}`,
    label: ({ topic }) => (topic ? `Morning briefing — ${topic}` : "Morning briefing"),
  },
  {
    id: "evening-review",
    name: "Evening review",
    blurb: "Two questions to close the day.",
    when: { kind: "daily", hhmm: "21:00" },
    prompt: () =>
      "Ask me, in two short questions, what I got done today and what comes first tomorrow. Be warm and brief.",
    label: () => "Evening review",
  },
  {
    id: "bedtime",
    name: "Bedtime nudge",
    blurb: "A gentle reminder to wind down.",
    when: { kind: "daily", hhmm: "22:30" },
    prompt: () => "Tell me, in one gentle sentence, that it is nearly bedtime and to put the screens away.",
    label: () => "Bedtime nudge",
  },
  {
    id: "reminder",
    name: "Daily reminder",
    blurb: "Say a thing at the same time every day.",
    when: { kind: "daily", hhmm: "09:00" },
    fields: [{ id: "what", label: "Remind me to", placeholder: "take my medication", required: true }],
    prompt: ({ what }) => `Remind me to ${what}. One short sentence.`,
    label: ({ what }) => `Remind: ${what.length > 40 ? `${what.slice(0, 37)}…` : what}`,
  },
  {
    id: "water",
    name: "Drink water",
    blurb: "A nudge to drink and stretch.",
    when: { kind: "every", minutes: 120 },
    costly: true,
    prompt: () => "Remind me, in one short sentence, to drink some water and stretch.",
    label: () => "Drink water",
  },
  {
    id: "news-watch",
    name: "Keep an eye on a topic",
    blurb: "One new thing about it, now and then.",
    when: { kind: "every", minutes: 180 },
    costly: true,
    fields: [{ id: "topic", label: "Topic", placeholder: "open-source LLMs", required: true }],
    prompt: ({ topic }) =>
      `Search the web for the latest on ${topic} and tell me the single most notable new thing in two sentences. ${BRIEF}`,
    label: ({ topic }) => `Watch: ${topic.length > 40 ? `${topic.slice(0, 37)}…` : topic}`,
  },
];

export const MAX_FIELD = 200;

export interface TemplateValues {
  /** "HH:MM" for a daily one. */
  time?: string;
  /** Minutes for an "every" one. */
  minutes?: number | string;
  /** Field values by id. */
  fields?: Record<string, string>;
}

export type TemplateResult =
  | { ok: true; prompt: string; label: string; schedule: Schedule }
  | { ok: false; error: string };

/** Fill a template in, or say what is missing. Doesn't store anything. */
export function buildFromTemplate(template: TaskTemplate, values: TemplateValues = {}): TemplateResult {
  const fields: Record<string, string> = {};
  for (const field of template.fields ?? []) {
    // One line, bounded: a field is a word or two dropped into a sentence.
    const value = String(values.fields?.[field.id] ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD);
    if (field.required && !value) return { ok: false, error: `${field.label}: this can't be empty.` };
    fields[field.id] = value;
  }

  let schedule: Schedule;
  if (template.when.kind === "daily") {
    const hhmm = (values.time ?? template.when.hhmm).trim();
    if (!parseHhmm(hhmm)) return { ok: false, error: `"${hhmm}" isn't a time of day. Use HH:MM, like 08:00.` };
    schedule = { kind: "daily", hhmm };
  } else {
    const minutes = Number(values.minutes ?? template.when.minutes);
    if (!Number.isInteger(minutes) || minutes < 1) return { ok: false, error: "Repeat every whole number of minutes, 1 or more." };
    if (minutes > 10_080) return { ok: false, error: "A week is the longest repeat (10,080 minutes)." };
    schedule = { kind: "every", minutes };
  }

  return { ok: true, prompt: template.prompt(fields), label: template.label(fields), schedule };
}
