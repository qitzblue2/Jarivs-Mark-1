"use client";

import { useEffect, useRef } from "react";
import NudgeToasts from "./NudgeToasts";
import type { ProviderState } from "./ModelPicker";
import { channels, type Situation } from "@/lib/initiative/gate";
import { inQuietHours } from "@/lib/initiative/config";
import { evaluateRules, focusOverNudge, inboxNudge, type Nudge, type NudgeAction } from "@/lib/initiative/rules";
import { troubleOf } from "@/lib/initiative/trouble";
import { fetchInbox } from "@/lib/initiative/inbox-client";
import type { RuleId } from "@/lib/initiative/config";
import {
  endFocus,
  flushQueue,
  focusUntilOf,
  getInitiative,
  moodEvent,
  moodLabel,
  noteNotified,
  noteSeen,
  offerNow,
  setSituationSource,
  unreadCount,
  useInitiative,
} from "@/lib/initiative/store";
import type { Message } from "@/lib/types";

/**
 * Where JARVIS notices things.
 *
 * Renders only the cards; the rest is a timer that, every few seconds, asks the
 * plain rules in lib/initiative/rules.ts whether anything is worth saying, and
 * hands what they find to the gate in lib/initiative/gate.ts, which decides
 * whether it may appear now. Nothing here calls a model, and nothing here
 * sends anything for you.
 */

interface Props {
  chatId: string | null;
  messages: Message[];
  providers: ProviderState[];
  provider: string;
  model: string;
  favorites: string[];
  /** How full the next request is, or null with no chat open. */
  contextRatio: number | null;
  streaming: boolean;
  voiceOpen: boolean;
  /** Approval cards waiting for an answer. */
  approvalCount: number;
  /** The chat last talked in. */
  lastChat: { id: string; title: string } | null;
  onAction: (nudge: Nudge, action: NudgeAction) => void;
  onMuted: (rule: RuleId, learned: boolean) => void;
}

const TICK_MS = 5000;
const INBOX_POLL_MS = 30_000;
/** Idle this long and a stretch of work is over. */
const GAP_MS = 10 * 60_000;
/** "Welcome back" is for the first minutes of a visit, not the whole of it. */
const WELCOME_WINDOW_MS = 2 * 60_000;
/** Server items older than this are not worth a card, only the inbox. */
const FRESH_MS = 24 * 60 * 60_000;
const MAX_CARDS_PER_POLL = 3;

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);

/** How things stand right now, for the gate. */
function readSituation(p: Pick<Props, "streaming" | "voiceOpen">, typedAt: number): Situation {
  const now = Date.now();
  const state = getInitiative();
  return {
    now,
    typing: now - typedAt < 4000,
    streaming: p.streaming,
    // Any open modal: the settings, the gallery, the inbox itself.
    dialogOpen: Boolean(document.querySelector('[aria-modal="true"]')),
    voiceOpen: p.voiceOpen,
    hidden: document.hidden,
    focusUntil: focusUntilOf(state),
    distressUntil: state.distressUntil,
  };
}

export default function InitiativeHost(props: Props) {
  const { onAction, onMuted } = props;
  const s = useInitiative();

  // What the timer reads: the latest props, without restarting the timer on every render.
  const live = useRef(props);
  live.current = props;

  const typedAt = useRef(0);
  const activity = useRef({ since: Date.now(), last: Date.now(), saved: 0 });
  const approvalSince = useRef(0);
  const visitStart = useRef(Date.now());
  const awayMs = useRef(0);
  const delivered = useRef(new Set<string>());

  // --- what the gate asks about ------------------------------------------------
  useEffect(() => {
    setSituationSource(() => readSituation(live.current, typedAt.current));
    return () => setSituationSource(null);
  }, []);

  // --- watching for activity ----------------------------------------------------
  useEffect(() => {
    const before = getInitiative().lastSeen;
    awayMs.current = before > 0 ? Math.max(0, Date.now() - before) : 0;

    const touch = () => {
      const now = Date.now();
      const a = activity.current;
      if (now - a.last > GAP_MS) a.since = now;
      a.last = now;
      // The moment you were last here, for "welcome back" — saved at most once a minute.
      if (now - a.saved > 60_000) {
        a.saved = now;
        noteSeen(now);
      }
    };
    const onInput = (e: Event) => {
      if (isTypingTarget(e.target)) typedAt.current = Date.now();
      touch();
    };
    touch();
    window.addEventListener("input", onInput, true);
    window.addEventListener("keydown", touch, true);
    window.addEventListener("pointerdown", touch, true);
    window.addEventListener("wheel", touch, { capture: true, passive: true });
    return () => {
      window.removeEventListener("input", onInput, true);
      window.removeEventListener("keydown", touch, true);
      window.removeEventListener("pointerdown", touch, true);
      window.removeEventListener("wheel", touch, true);
    };
  }, []);

  // --- the timer ------------------------------------------------------------------
  useEffect(() => {
    const tick = () => {
      const p = live.current;
      const now = Date.now();
      const state = getInitiative();

      // The focus timer ran out: say so, and let the held cards through.
      if (state.focus && state.focus.until !== null && state.focus.until <= now) {
        const minutes = endFocus(now);
        moodEvent("focus-done", now);
        offerNow(focusOverNudge(minutes, now), { focusUntil: 0 });
      }

      if (p.approvalCount > 0) {
        if (!approvalSince.current) approvalSince.current = now;
      } else approvalSince.current = 0;

      const a = activity.current;
      const idle = now - a.last > GAP_MS;

      const nudges = evaluateRules({
        now,
        chatId: p.chatId,
        contextRatio: p.contextRatio,
        trouble: troubleOf(p.messages, p.providers, { provider: p.provider, model: p.model }, p.favorites),
        activeMs: idle ? 0 : now - a.since,
        approvalWaitMs: approvalSince.current ? now - approvalSince.current : 0,
        awayMs: now - visitStart.current < WELCOME_WINDOW_MS ? awayMs.current : 0,
        lastChat: p.lastChat,
        hour: new Date(now).getHours(),
        mood: moodLabel(state, now),
      });
      // Waiting cards first: they are older than anything just found.
      flushQueue(readSituation(p, typedAt.current));
      for (const nudge of nudges) offerNow(nudge);
    };

    const first = setTimeout(tick, 1500);
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  // A reply that has just finished is a calm moment, and the place to notice it went wrong.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !props.streaming) {
      const timer = setTimeout(() => flushQueue(readSituation({ streaming: false, voiceOpen: live.current.voiceOpen }, typedAt.current)), 600);
      wasStreaming.current = props.streaming;
      return () => clearTimeout(timer);
    }
    wasStreaming.current = props.streaming;
  }, [props.streaming]);

  // --- the server's inbox ------------------------------------------------------------
  useEffect(() => {
    let stopped = false;

    const poll = async () => {
      const items = await fetchInbox();
      if (stopped || !items) return;
      const now = Date.now();
      const state = getInitiative();
      const since = Math.max(state.lastNotified, now - FRESH_MS);
      const fresh = items.filter((i) => !i.read && i.at > since).sort((a, b) => a.at - b.at);
      for (const item of fresh.slice(-MAX_CARDS_PER_POLL)) offerNow(inboxNudge(item, now));
      // Everything seen counts as offered: the older ones are in the inbox, badge and all.
      if (fresh.length > 0) noteNotified(fresh[fresh.length - 1].at);
    };

    void poll();
    const timer = setInterval(poll, INBOX_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // --- louder channels, only when asked for ------------------------------------------
  useEffect(() => {
    for (const toast of s.toasts) {
      if (delivered.current.has(toast.nudge.id)) continue;
      delivered.current.add(toast.nudge.id);

      const now = new Date();
      const via = channels(s.config, { hidden: document.hidden }, inQuietHours(now, s.config.quietHours));
      if (via.desktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const n = new Notification(toast.nudge.title, { body: toast.nudge.body, tag: toast.nudge.id });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch {
          /* some browsers only allow it from a service worker; the card is still there */
        }
      }
      if (via.speak && typeof speechSynthesis !== "undefined") {
        try {
          speechSynthesis.cancel();
          speechSynthesis.speak(new SpeechSynthesisUtterance([toast.nudge.title, toast.nudge.body].filter(Boolean).join(". ")));
        } catch {
          /* no voice available */
        }
      }
    }
  }, [s.toasts, s.config]);

  // --- the tab title, for when you are in another tab ---------------------------------------
  const unread = unreadCount(s);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    const apply = () => {
      document.title = document.hidden && unread > 0 ? `(${unread}) ${base}` : base;
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      document.title = base;
    };
  }, [unread]);

  return <NudgeToasts onAction={onAction} onMuted={onMuted} />;
}
