"use client";

import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { endFocus, focusActive, startFocus, useInitiative } from "@/lib/initiative/store";

const CHOICES: { minutes: number | null; label: string }[] = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 25, label: "25 minutes" },
  { minutes: 45, label: "45 minutes" },
  { minutes: 60, label: "An hour" },
  { minutes: null, label: "Until I stop it" },
];

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * A do-not-disturb timer. While it runs nothing pops up: cards that would have
 * appeared wait in the inbox, and a card tells you when the time is up. Yours to
 * start and to end — JARVIS never starts one, and a scheduled result still
 * reaches the inbox rather than interrupting.
 */
export default function FocusTimer() {
  const s = useInitiative();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const active = focusActive(s, now);
  const until = s.focus?.until ?? null;

  // A countdown only while there is one to show.
  useEffect(() => {
    if (!active || until === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, until]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const minutesLeft = until === null ? null : Math.max(1, Math.ceil((until - now) / 60_000));
  const label = !active
    ? "Focus timer"
    : minutesLeft === null
      ? "Focus is on, until you stop it"
      : `Focus: ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} left`;

  return (
    <div className="relative" ref={root} data-focus-timer>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        title={active ? "Focus is on — nothing will pop up. Click to end it." : "Focus timer — hold everything for a while"}
        data-focus-button
        data-focus-active={active ? "true" : undefined}
        className={`flex items-center gap-1 rounded-md p-1.5 transition hover:bg-raised ${active ? "text-arc" : "text-ink-faint hover:text-ink"}`}
      >
        <Timer size={16} aria-hidden />
        {active && (
          <span className="font-mono text-[11px] tabular-nums" aria-hidden data-focus-clock>
            {until === null ? "on" : clock(until - now)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="group"
          aria-label="Focus timer"
          className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-line bg-panel p-2 shadow-xl"
        >
          {active ? (
            <>
              <p className="px-1.5 pb-2 text-[12px] leading-relaxed text-ink-dim">
                Nothing will pop up. Whatever would have is waiting in the inbox.
              </p>
              <button
                type="button"
                onClick={() => {
                  endFocus();
                  setOpen(false);
                  trigger.current?.focus();
                }}
                data-focus-end
                className="w-full rounded-md border border-line px-2.5 py-1.5 text-left text-[12.5px] text-ink transition hover:border-arc-dim/50"
              >
                End focus now
              </button>
            </>
          ) : (
            <>
              <p className="px-1.5 pb-1.5 text-[11.5px] leading-relaxed text-ink-faint">Hold cards back for…</p>
              <ul className="space-y-0.5">
                {CHOICES.map((c) => (
                  <li key={c.label}>
                    <button
                      type="button"
                      onClick={() => {
                        startFocus(c.minutes);
                        setOpen(false);
                        trigger.current?.focus();
                      }}
                      data-focus-start={c.minutes ?? "open"}
                      className="w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink-dim transition hover:bg-raised hover:text-ink"
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
