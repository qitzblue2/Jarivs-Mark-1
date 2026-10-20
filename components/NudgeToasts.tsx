"use client";

import { useEffect, useState } from "react";
import { Bell, BrainCircuit, Clock3, Coffee, Gauge, History, MessageSquareText, Moon, ShieldAlert, Sparkles, X } from "lucide-react";
import { closeToast, TOAST_MS, useInitiative, type Dismissal, type Toast } from "@/lib/initiative/store";
import type { RuleId } from "@/lib/initiative/config";
import type { Nudge, NudgeAction, NudgeRule } from "@/lib/initiative/rules";

const ICON: Record<NudgeRule, typeof Bell> = {
  "long-chat": Gauge,
  "provider-trouble": ShieldAlert,
  break: Coffee,
  "late-night": Moon,
  "approval-waiting": ShieldAlert,
  "welcome-back": History,
  "remember-offer": BrainCircuit,
  "focus-over": Clock3,
  inbox: MessageSquareText,
};

/** Cards that are yours — a timer, a scheduled result — aren't suggestions, so there is nothing to stop. */
const MUTABLE = (rule: NudgeRule) => rule !== "inbox" && rule !== "focus-over";

interface Props {
  /** Do what the button says. The card closes itself afterwards. */
  onAction: (nudge: Nudge, action: NudgeAction) => void;
  /** A rule has just been switched off — by "stop suggesting this", or by being waved away three times. Say so. */
  onMuted: (rule: RuleId, learned: boolean) => void;
}

/**
 * Cards from JARVIS, bottom right, above the message box.
 *
 * Built so that being interrupted is as cheap as it can be: they never take
 * focus, they stay out of the way of the Send button, a keyboard user can reach
 * them with Tab and wave one away with Escape, the countdown stops while the
 * pointer or focus is on one or the tab is in the background, and every card
 * has a plain way to say "stop suggesting this".
 */
/** How far up from the bottom of the window the message box begins, so a card sits above it and never over it. */
function useAboveComposer(): number {
  const [bottom, setBottom] = useState(112);
  useEffect(() => {
    const box = document.querySelector<HTMLElement>("[data-composer]");
    const measure = () => {
      if (!box) return;
      setBottom(Math.max(16, Math.round(window.innerHeight - box.getBoundingClientRect().top + 10)));
    };
    measure();
    // The box grows as you type a long message, and the window can be resized.
    const observer = typeof ResizeObserver === "undefined" || !box ? null : new ResizeObserver(measure);
    if (box) observer?.observe(box);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return bottom;
}

export default function NudgeToasts({ onAction, onMuted }: Props) {
  const { toasts } = useInitiative();
  const bottom = useAboveComposer();
  return (
    <div
      role="region"
      aria-label="Suggestions from JARVIS"
      aria-live="polite"
      data-nudges
      style={{ bottom }}
      className="pointer-events-none fixed right-3 z-40 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-4"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.nudge.id} toast={toast} onAction={onAction} onMuted={onMuted} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onAction, onMuted }: { toast: Toast; onAction: Props["onAction"]; onMuted: Props["onMuted"] }) {
  const { nudge } = toast;
  const close = (how: Dismissal) => {
    const { mutedRule } = closeToast(nudge.id, how);
    if (mutedRule) onMuted(mutedRule, how !== "mute");
  };
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const Icon = ICON[nudge.rule] ?? Sparkles;

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Goes away on its own, unread in the inbox — unless you are looking at it.
  useEffect(() => {
    if (held || hidden) return;
    const timer = setTimeout(() => closeToast(nudge.id, "timeout"), TOAST_MS);
    return () => clearTimeout(timer);
  }, [held, hidden, nudge.id]);

  return (
    <div
      role="group"
      aria-label={nudge.title}
      data-nudge={nudge.rule}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close("dismiss");
        }
      }}
      className="nudge-in pointer-events-auto rounded-xl border border-line bg-panel p-3 shadow-xl"
    >
      <div className="flex items-start gap-2.5">
        <Icon size={15} className="mt-0.5 shrink-0 text-arc" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug text-ink">{nudge.title}</p>
          {nudge.body && <p className="mt-0.5 break-words text-[12px] leading-relaxed text-ink-dim">{nudge.body}</p>}
        </div>
        <button
          type="button"
          onClick={() => close("dismiss")}
          aria-label="Dismiss"
          title="Dismiss"
          data-nudge-dismiss
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink"
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[25px]">
        {nudge.actions.map((action, i) => (
          <button
            key={`${action.kind}-${i}`}
            type="button"
            data-nudge-action={action.kind}
            onClick={() => {
              onAction(nudge, action);
              close("used");
            }}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
              i === 0 ? "bg-arc-solid text-white hover:bg-arc-solid-hover" : "border border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"
            }`}
          >
            {action.label}
          </button>
        ))}
        {nudge.actions.length === 0 && (
          <button
            type="button"
            data-nudge-ok
            onClick={() => close("used")}
            className="rounded-md border border-line px-2.5 py-1 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink"
          >
            Got it
          </button>
        )}
        {MUTABLE(nudge.rule) && (
          <button
            type="button"
            data-nudge-mute
            onClick={() => close("mute")}
            className="ml-auto rounded px-1.5 py-1 text-[11px] text-ink-faint underline-offset-2 transition hover:text-ink hover:underline"
          >
            Stop suggesting this
          </button>
        )}
      </div>
    </div>
  );
}
