"use client";

import { useSyncExternalStore } from "react";
import { cleanConfig, DEFAULT_CONFIG, type InitiativeConfig, type RuleId } from "./config";
import {
  decide,
  EMPTY_GATE,
  forgetRule,
  recordAccepted,
  recordDismissal,
  recordShown,
  type Decision,
  type GateState,
  type Situation,
} from "./gate";
import { applyEvent, CALM, decay, labelOf, type Mood, type MoodEvent, type MoodLabel } from "./mood";
import type { Nudge } from "./rules";
import { quietFor, toneMoodEvent, type Tone } from "./tone";
import type { InboxItem } from "@/lib/inbox";

/**
 * The live state of JARVIS's initiative for this tab: its settings, what it has
 * learned about when to keep quiet, its mood, the cards on screen and waiting,
 * a short history, and the focus timer — kept in step with localStorage and
 * with other tabs.
 *
 * Settled here rather than in components because the things that feed it are
 * scattered: a 👍 in a message, a failed request in the send path, a tick in a
 * host component. Each calls a function below; each function changes the state
 * once, saves it, and tells whoever is listening.
 */

export interface Toast {
  nudge: Nudge;
  shownAt: number;
}

export type HistoryState = "shown" | "held" | "used" | "dismissed";

export interface HistoryItem {
  nudge: Nudge;
  state: HistoryState;
  at: number;
  read: boolean;
}

export interface Focus {
  /** When it ends, or null for "until I stop it". */
  until: number | null;
  startedAt: number;
}

export interface InitiativeState {
  config: InitiativeConfig;
  gate: GateState;
  mood: Mood;
  focus: Focus | null;
  /** After a message that calls for quiet: no cards until then. */
  distressUntil: number;
  toasts: Toast[];
  /** Waiting for a calm moment, with when they started to wait. */
  queue: { nudge: Nudge; queuedAt: number }[];
  history: HistoryItem[];
  /** What the server has for you. */
  server: { items: InboxItem[]; unread: number };
  /** The latest server item already offered as a card, so a reload doesn't repeat it. */
  lastNotified: number;
  /** When you were last active, for "welcome back". */
  lastSeen: number;
}

export const KEY = "jarvis.initiative.v1";
export const MAX_TOASTS = 3;
export const MAX_HISTORY = 50;
/** A card that has waited this long for a calm moment goes to the inbox instead. */
export const QUEUE_PATIENCE_MS = 5 * 60_000;
export const TOAST_MS = 14_000;

const INITIAL: InitiativeState = {
  config: DEFAULT_CONFIG,
  gate: EMPTY_GATE,
  mood: CALM,
  focus: null,
  distressUntil: 0,
  toasts: [],
  queue: [],
  history: [],
  server: { items: [], unread: 0 },
  lastNotified: 0,
  lastSeen: 0,
};

let state: InitiativeState = INITIAL;
let started = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** What survives a reload: not the cards on screen, and not the server's items (fetched afresh). */
function persist(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      KEY,
      JSON.stringify({
        config: state.config,
        gate: state.gate,
        mood: state.mood,
        focus: state.focus,
        distressUntil: state.distressUntil,
        history: state.history,
        lastNotified: state.lastNotified,
        lastSeen: state.lastSeen,
      }),
    );
  } catch {
    /* a full quota costs only the memory of when to stay quiet */
  }
}

function load(): InitiativeState {
  const store = storage();
  if (!store) return INITIAL;
  try {
    const raw = JSON.parse(store.getItem(KEY) ?? "null") as Partial<InitiativeState> | null;
    if (!raw || typeof raw !== "object") return INITIAL;
    const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
    const gate = (raw.gate ?? {}) as Partial<GateState>;
    const mood = (raw.mood ?? {}) as Partial<Mood>;
    return {
      ...INITIAL,
      config: cleanConfig(raw.config),
      gate: {
        shown: Array.isArray(gate.shown) ? gate.shown.filter((t) => typeof t === "number") : [],
        lastByRule: gate.lastByRule && typeof gate.lastByRule === "object" ? gate.lastByRule : {},
        snoozedUntil: gate.snoozedUntil && typeof gate.snoozedUntil === "object" ? gate.snoozedUntil : {},
        dismissals: gate.dismissals && typeof gate.dismissals === "object" ? gate.dismissals : {},
        learnedMutes: Array.isArray(gate.learnedMutes) ? gate.learnedMutes : [],
      },
      mood: { valence: num(mood.valence), energy: num(mood.energy, CALM.energy), cause: mood.cause === "reply" || mood.cause === "situation" ? mood.cause : null, at: num(mood.at) },
      focus:
        raw.focus && typeof raw.focus === "object" && typeof (raw.focus as Focus).startedAt === "number"
          ? { until: typeof (raw.focus as Focus).until === "number" ? (raw.focus as Focus).until : null, startedAt: (raw.focus as Focus).startedAt }
          : null,
      distressUntil: num(raw.distressUntil),
      history: Array.isArray(raw.history) ? (raw.history as HistoryItem[]).slice(0, MAX_HISTORY) : [],
      lastNotified: num(raw.lastNotified),
      lastSeen: num(raw.lastSeen),
    };
  } catch {
    return INITIAL;
  }
}

function emit(): void {
  for (const l of listeners) l();
}

/** Replace the state, save it, tell everyone. */
function set(next: Partial<InitiativeState>): void {
  state = { ...state, ...next };
  persist();
  emit();
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  state = load();
  // Another tab changed the settings or the focus timer.
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    const fresh = load();
    state = { ...state, config: fresh.config, gate: fresh.gate, focus: fresh.focus, distressUntil: fresh.distressUntil, mood: fresh.mood };
    emit();
  });
}

export function getInitiative(): InitiativeState {
  start();
  return state;
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInitiative(): InitiativeState {
  return useSyncExternalStore(subscribe, getInitiative, () => INITIAL);
}

// --- settings ---------------------------------------------------------------

export function setConfig(patch: Partial<InitiativeConfig>): void {
  start();
  const config = cleanConfig({ ...state.config, ...patch });
  let gate = state.gate;
  // Turning a rule back on forgets that it was muted for being dismissed too often.
  for (const id of Object.keys(config.rules) as RuleId[]) {
    if (config.rules[id] && !state.config.rules[id]) gate = forgetRule(gate, id);
  }
  set({ config, gate });
}

export function setRule(rule: RuleId, on: boolean): void {
  start();
  setConfig({ rules: { ...state.config.rules, [rule]: on } });
}

// --- mood ---------------------------------------------------------------------

export function moodEvent(event: MoodEvent, now = Date.now()): void {
  start();
  set({ mood: applyEvent(state.mood, event, now) });
}

/** The mood as it is now: what it was, drifted back toward calm for the time since. */
export function moodLabel(s: InitiativeState = state, now = Date.now()): MoodLabel {
  return labelOf(decay(s.mood, now));
}

/**
 * What reading a tone does: after a hard message, cards stay away (and the ones
 * on screen are cleared); after the rest, the mood moves a little.
 */
export function noteTone(tone: Tone, now = Date.now()): void {
  start();
  const quiet = quietFor(tone);
  if (quiet > 0) {
    set({ distressUntil: Math.max(state.distressUntil, now + quiet), toasts: [], queue: [] });
    return;
  }
  const event = toneMoodEvent(tone);
  if (event) set({ mood: applyEvent(state.mood, event, now) });
}

// --- cards --------------------------------------------------------------------

/**
 * A card made from a server item (a scheduled answer, a failed backup) is already
 * listed, and counted, as that item; a second entry here would count it twice.
 */
const fromServer = (nudge: Nudge) => nudge.id.startsWith("inbox:");

function addHistory(nudge: Nudge, status: HistoryState, now: number, read: boolean): HistoryItem[] {
  if (fromServer(nudge)) return state.history;
  return [{ nudge, state: status, at: now, read }, ...state.history].slice(0, MAX_HISTORY);
}

/** A held card still counts as raised for its cooldown — otherwise it would be re-held every few seconds. */
function heldGate(gate: GateState, nudge: Nudge, now: number): GateState {
  return { ...gate, lastByRule: { ...gate.lastByRule, [nudge.rule]: now } };
}

/**
 * Put a card through the gate and do what it says: show it, hold it for a calm
 * moment, file it in the inbox, or let it go. Offering the same card twice is
 * harmless: one already on screen, waiting, or offered in the last hour is ignored.
 */
export function offer(nudge: Nudge, sit: Situation): Decision {
  start();
  const { now } = sit;
  if (state.toasts.some((t) => t.nudge.id === nudge.id) || state.queue.some((q) => q.nudge.id === nudge.id)) {
    return { action: "drop", reason: "already pending" };
  }
  if (state.history.some((h) => h.nudge.id === nudge.id && now - h.at < 60 * 60_000)) {
    return { action: "drop", reason: "already offered" };
  }

  const decision = decide(nudge, state.config, state.gate, sit);
  switch (decision.action) {
    case "show":
      set({
        toasts: [...state.toasts, { nudge, shownAt: now }].slice(-MAX_TOASTS),
        gate: recordShown(state.gate, nudge, now),
        history: addHistory(nudge, "shown", now, false),
      });
      break;
    case "queue":
      set({ queue: [...state.queue, { nudge, queuedAt: now }] });
      break;
    case "inbox":
      set({ gate: heldGate(state.gate, nudge, now), history: addHistory(nudge, "held", now, false) });
      break;
  }
  return decision;
}

let situationSource: (() => Situation) | null = null;

/**
 * The host component says how things stand — typing, streaming, a dialog open —
 * so code far from it (the send path) can offer a card without knowing.
 */
export function setSituationSource(source: (() => Situation) | null): void {
  situationSource = source;
}

/** Offer a card now, in the situation the host reports (with anything the caller knows better overridden). */
export function offerNow(nudge: Nudge, overrides: Partial<Situation> = {}): Decision {
  const base: Situation = situationSource
    ? situationSource()
    : { now: Date.now(), typing: false, streaming: false, dialogOpen: false, voiceOpen: false, hidden: false, focusUntil: focusUntilOf(), distressUntil: state.distressUntil };
  return offer(nudge, { ...base, ...overrides });
}

/**
 * Try the waiting cards again. Those that have waited too long for a calm
 * moment are filed in the inbox: a suggestion about a chat you left five
 * minutes ago is no longer a suggestion.
 */
export function flushQueue(sit: Situation): Nudge[] {
  start();
  if (state.queue.length === 0) return [];
  const shown: Nudge[] = [];
  const waiting = state.queue;
  set({ queue: [] });
  for (const item of waiting) {
    if (sit.now - item.queuedAt > QUEUE_PATIENCE_MS) {
      set({ history: addHistory(item.nudge, "held", sit.now, false) });
      continue;
    }
    const d = offer(item.nudge, sit);
    if (d.action === "show") shown.push(item.nudge);
    else if (d.action === "queue") {
      // offer() queued it afresh, which would restart its patience; keep the original wait.
      state = { ...state, queue: state.queue.map((q) => (q.nudge.id === item.nudge.id ? { ...q, queuedAt: item.queuedAt } : q)) };
    }
  }
  return shown;
}

export type Dismissal = "dismiss" | "timeout" | "mute" | "used";

function settle(id: string, status: HistoryState, read: boolean): HistoryItem[] {
  return state.history.map((h) => (h.nudge.id === id && h.state === "shown" ? { ...h, state: status, read } : h));
}

/**
 * A card goes away. Waving it away counts against its rule (three times in a
 * week and it stops); using it forgives; letting it time out counts for
 * nothing but stays unread in the inbox; "stop suggesting this" mutes the rule now.
 */
export function closeToast(id: string, how: Dismissal, now = Date.now()): { mutedRule: RuleId | null } {
  start();
  const toast = state.toasts.find((t) => t.nudge.id === id);
  if (!toast) return { mutedRule: null };
  const rest = state.toasts.filter((t) => t.nudge.id !== id);
  const rule = toast.nudge.rule;
  let gate = state.gate;
  let config = state.config;
  let mutedRule: RuleId | null = null;

  if (how === "used") {
    gate = recordAccepted(gate, rule);
  } else if (how === "dismiss") {
    const r = recordDismissal(gate, rule, now);
    gate = r.gate;
    if (r.mutedNow) mutedRule = rule as RuleId;
  } else if (how === "mute" && rule !== "inbox" && rule !== "focus-over") {
    config = { ...config, rules: { ...config.rules, [rule]: false } };
    mutedRule = rule as RuleId;
  }

  set({
    toasts: rest,
    gate,
    config,
    history: settle(id, how === "used" ? "used" : how === "timeout" ? "shown" : "dismissed", how !== "timeout"),
  });
  return { mutedRule };
}

// --- the inbox ----------------------------------------------------------------

export function setServerInbox(items: InboxItem[]): void {
  start();
  set({ server: { items, unread: items.filter((i) => !i.read).length } });
}

export function noteNotified(at: number): void {
  start();
  if (at > state.lastNotified) set({ lastNotified: at });
}

export function noteSeen(now = Date.now()): void {
  start();
  state = { ...state, lastSeen: now };
  persist();
}

export function markHistoryRead(): void {
  start();
  if (state.history.every((h) => h.read)) return;
  set({ history: state.history.map((h) => (h.read ? h : { ...h, read: true })) });
}

export function clearHistory(): void {
  start();
  set({ history: [] });
}

export function unreadCount(s: InitiativeState = state): number {
  return s.history.filter((h) => !h.read).length + s.server.unread;
}

// --- focus ----------------------------------------------------------------------

export function startFocus(minutes: number | null, now = Date.now()): void {
  start();
  set({ focus: { until: minutes ? now + minutes * 60_000 : null, startedAt: now } });
}

/** End it now (or note that it ran out). Returns how many minutes it lasted. */
export function endFocus(now = Date.now()): number | null {
  start();
  const focus = state.focus;
  if (!focus) return null;
  set({ focus: null });
  return Math.max(1, Math.round((now - focus.startedAt) / 60_000));
}

/** For the gate: when focus ends, with "until I stop it" as far off as it gets. */
export function focusUntilOf(s: InitiativeState = state): number {
  if (!s.focus) return 0;
  return s.focus.until === null ? Number.MAX_SAFE_INTEGER : s.focus.until;
}

export function focusActive(s: InitiativeState = state, now = Date.now()): boolean {
  return Boolean(s.focus && (s.focus.until === null || s.focus.until > now));
}

/** "Forget what it has learned": rules muted for being waved away come back, and the counts start over. */
export function forgetLearned(): void {
  start();
  set({ gate: { ...state.gate, dismissals: {}, snoozedUntil: {}, learnedMutes: [] } });
}

/** For tests. */
export function resetInitiative(): void {
  state = INITIAL;
  started = false;
  situationSource = null;
}
