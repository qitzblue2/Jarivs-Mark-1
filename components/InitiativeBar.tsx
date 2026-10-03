"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import FocusTimer from "./FocusTimer";
import { moodLabel, unreadCount, useInitiative } from "@/lib/initiative/store";
import { MOOD_WORD, moodSummary, type MoodLabel } from "@/lib/initiative/mood";

/** The colour is never the only signal: the word beside it, and the sentence in the label, say the same. */
const DOT: Record<MoodLabel, string> = {
  calm: "bg-ink-faint",
  focused: "bg-arc",
  pleased: "bg-ok",
  delighted: "bg-ok",
  concerned: "bg-warn",
  apologetic: "bg-warn",
};

/**
 * A summary of how the session is going, as a dot and a word. Not a claim of
 * feeling: it moves when you 👍 or 👎 a reply, thank it, or a request fails,
 * and drifts back to calm by itself. Hidden by a setting for anyone who finds
 * it twee.
 */
function MoodOrb() {
  const s = useInitiative();
  // The mood fades with time, so it is re-read now and then rather than only when something happens.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);
  if (!s.config.showMood) return null;

  const label = moodLabel(s, now);
  const happy = label === "delighted" || label === "pleased";
  return (
    <span
      role="img"
      aria-label={`Mood: ${MOOD_WORD[label]}. ${moodSummary(label)}`}
      title={`${moodSummary(label)} (a summary of the session, not a feeling)`}
      data-mood={label}
      className="flex items-center gap-1.5 px-1.5 text-[11px] text-ink-faint"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[label]} ${happy ? "mood-glow" : ""}`} aria-hidden />
      <span className="hidden md:inline" aria-hidden>
        {MOOD_WORD[label]}
      </span>
    </span>
  );
}

/** Mood, focus timer and inbox, in one place at the end of the chat's title bar. */
export default function InitiativeBar({ onOpenInbox }: { onOpenInbox: () => void }) {
  const s = useInitiative();
  const unread = unreadCount(s);

  return (
    <div className="flex shrink-0 items-center" data-initiative-bar>
      <MoodOrb />
      <FocusTimer />
      <button
        type="button"
        onClick={onOpenInbox}
        aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
        title={unread > 0 ? `${unread} unread — suggestions and results waiting for you` : "Inbox — suggestions and results from while you were busy"}
        data-inbox-button
        className="relative rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink"
      >
        <Bell size={16} aria-hidden />
        {unread > 0 && (
          <span
            data-inbox-badge
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-arc-solid px-1 text-[9px] font-bold text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
