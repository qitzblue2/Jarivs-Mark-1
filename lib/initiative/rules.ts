import type { MoodLabel } from "./mood";
import type { RuleId } from "./config";

/**
 * What JARVIS might volunteer, and when.
 *
 * Every rule here is a plain check over things the browser already knows — how
 * full the context is, how long you've been at it, whether replies keep failing
 * — so noticing costs nothing: no model call, no quota. A card never *does*
 * anything on its own; its buttons fill the message box or move you somewhere,
 * and you press Enter. Nothing is ever sent on your behalf.
 */

export type NudgeAction =
  /** Put text in the message box — for you to read, change and send. */
  | { kind: "fill"; label: string; text: string }
  | { kind: "new-chat"; label: string }
  | { kind: "open-chat"; label: string; chatId: string }
  | { kind: "switch-model"; label: string; provider: string; model: string }
  /** Save a fact to memory — only when you press it. */
  | { kind: "remember"; label: string; text: string; always?: boolean }
  | { kind: "show-approval"; label: string }
  | { kind: "open-inbox"; label: string };

export type NudgeRule = RuleId | "focus-over" | "inbox";

export interface Nudge {
  /** Unique for this occasion, so the same thing isn't offered twice at once. */
  id: string;
  rule: NudgeRule;
  title: string;
  body?: string;
  actions: NudgeAction[];
  /** You asked for it — a timer, a scheduled task — so the hourly cap doesn't apply. */
  requested?: boolean;
  at: number;
}

export interface RuleContext {
  now: number;
  chatId: string | null;
  /** How full the next request is (the context meter), or null with no chat open. */
  contextRatio: number | null;
  /** Consecutive recent replies that failed or had to fall back to another provider. */
  trouble: { failures: number; provider: string; model: string; alternative: { provider: string; model: string; label: string } | null } | null;
  /** How long you have been at it without a gap of ten minutes. */
  activeMs: number;
  /** How long the oldest unanswered approval has waited; 0 if none. */
  approvalWaitMs: number;
  /** How long you were away before this visit began. */
  awayMs: number;
  lastChat: { id: string; title: string } | null;
  /** Local hour, 0–23. */
  hour: number;
  mood: MoodLabel;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const THRESHOLDS = {
  contextRatio: 0.85,
  troubleFailures: 2,
  breakAfterMs: 90 * MINUTE,
  approvalAfterMs: 45_000,
  awayMs: 4 * HOUR,
  /** Late means: from 23:00 until 04:00. */
  lateFrom: 23,
  lateUntil: 4,
  /** Not "late" for someone who just glanced in. */
  lateActiveMs: 10 * MINUTE,
} as const;

export const SUMMARY_PROMPT =
  "Summarize our conversation so far in five bullet points, then list anything still unresolved.";
export const TOMORROW_PROMPT =
  "Summarize where we've got to and the next steps, so I can pick this up tomorrow.";

/** The night a late hour belongs to: after midnight is still last night, so it is offered once, not twice. */
function nightOf(now: number, hour: number): string {
  const d = new Date(now);
  if (hour < THRESHOLDS.lateUntil) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const gentle = (mood: MoodLabel) => mood === "concerned" || mood === "apologetic";
const upbeat = (mood: MoodLabel) => mood === "pleased" || mood === "delighted";

export function evaluateRules(ctx: RuleContext): Nudge[] {
  const out: Nudge[] = [];
  const at = ctx.now;

  if (ctx.chatId && ctx.contextRatio !== null && ctx.contextRatio >= THRESHOLDS.contextRatio) {
    const full = ctx.contextRatio >= 1;
    out.push({
      id: `long-chat:${ctx.chatId}`,
      rule: "long-chat",
      title: full ? "This chat no longer fits" : "This chat is getting long",
      body: full
        ? "The oldest messages are being left out of what the model sees. A summary in a fresh chat keeps what mattered."
        : "It is nearly at what one request can hold. A summary now, in a fresh chat, keeps what mattered.",
      actions: [
        { kind: "fill", label: "Summarise it", text: SUMMARY_PROMPT },
        { kind: "new-chat", label: "Start fresh" },
      ],
      at,
    });
  }

  if (ctx.trouble && ctx.trouble.failures >= THRESHOLDS.troubleFailures) {
    const alt = ctx.trouble.alternative;
    out.push({
      id: `provider-trouble:${ctx.trouble.provider}`,
      rule: "provider-trouble",
      title: `${ctx.trouble.model} keeps failing`,
      body: alt ? `Another model is ready: ${alt.label}.` : "No other model is ready — a key in Settings would give it somewhere else to go.",
      actions: alt ? [{ kind: "switch-model", label: `Switch to ${alt.label}`, provider: alt.provider, model: alt.model }] : [],
      at,
    });
  }

  if (ctx.activeMs >= THRESHOLDS.breakAfterMs) {
    const minutes = Math.round(ctx.activeMs / MINUTE);
    out.push({
      id: `break:${Math.floor(ctx.activeMs / THRESHOLDS.breakAfterMs)}`,
      rule: "break",
      title: gentle(ctx.mood)
        ? `Hey — that's ${minutes} minutes without a break`
        : upbeat(ctx.mood)
          ? `Good session — ${minutes} minutes in`
          : `You've been at it for ${minutes} minutes`,
      body: "Worth standing up for a minute. It will all still be here.",
      actions: [],
      at,
    });
  }

  const late = ctx.hour >= THRESHOLDS.lateFrom || ctx.hour < THRESHOLDS.lateUntil;
  if (late && ctx.activeMs >= THRESHOLDS.lateActiveMs) {
    out.push({
      id: `late-night:${nightOf(ctx.now, ctx.hour)}`,
      rule: "late-night",
      title: "It's late",
      body: gentle(ctx.mood) ? "This has been a rough stretch — it may look better after some sleep." : "A good place to stop? I can write up where we've got to.",
      actions: [{ kind: "fill", label: "Summarise for tomorrow", text: TOMORROW_PROMPT }],
      at,
    });
  }

  if (ctx.approvalWaitMs >= THRESHOLDS.approvalAfterMs) {
    out.push({
      id: "approval-waiting",
      rule: "approval-waiting",
      title: "JARVIS is waiting for your OK",
      body: "It asked to change something and nothing happens until you answer.",
      actions: [{ kind: "show-approval", label: "Show me" }],
      at,
    });
  }

  if (ctx.awayMs >= THRESHOLDS.awayMs && ctx.lastChat) {
    out.push({
      id: `welcome-back:${ctx.lastChat.id}`,
      rule: "welcome-back",
      title: "Welcome back",
      body: `Last time: “${ctx.lastChat.title}”.`,
      actions: [{ kind: "open-chat", label: "Pick it up", chatId: ctx.lastChat.id }],
      at,
    });
  }

  return out;
}

/** "Remember that?" — offered when a message states something lasting. */
export function rememberNudge(text: string, now: number): Nudge {
  return {
    id: `remember-offer:${text}`,
    rule: "remember-offer",
    title: "Remember that?",
    body: text,
    actions: [
      { kind: "remember", label: "Remember", text },
      { kind: "remember", label: "Always keep in mind", text, always: true },
    ],
    at: now,
  };
}

/** The focus timer ran out. Yours, so it is exempt from the hourly cap. */
export function focusOverNudge(minutes: number | null, now: number): Nudge {
  return {
    id: `focus-over:${now}`,
    rule: "focus-over",
    title: minutes ? `Focus time's up — ${minutes} minutes` : "Focus is over",
    body: "Nicely done. Cards can interrupt again; anything held back is in the inbox.",
    actions: [{ kind: "open-inbox", label: "See what I held back" }],
    requested: true,
    at: now,
  };
}

/** Something that arrived from the server — a scheduled task's answer, a failed backup. */
export function inboxNudge(item: { id: string; title: string; body: string }, now: number): Nudge {
  return {
    id: `inbox:${item.id}`,
    rule: "inbox",
    title: item.title,
    body: item.body,
    actions: [{ kind: "open-inbox", label: "Open the inbox" }],
    requested: true,
    at: now,
  };
}
