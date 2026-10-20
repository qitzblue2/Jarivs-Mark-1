"use client";

import { useEffect, useState } from "react";
import { Bell, DatabaseBackup, CalendarClock, Settings, Trash2, X } from "lucide-react";
import { formatTime } from "@/lib/format";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";
import { clearHistory, getInitiative, markHistoryRead, useInitiative, type HistoryItem, type HistoryState } from "@/lib/initiative/store";
import { clearServer, fetchInbox, markServerRead } from "@/lib/initiative/inbox-client";
import type { Nudge, NudgeAction } from "@/lib/initiative/rules";

interface Props {
  open: boolean;
  onClose: () => void;
  onAction: (nudge: Nudge, action: NudgeAction) => void;
  onOpenSettings: () => void;
}

const STATE_LABEL: Record<HistoryState, string> = {
  shown: "Shown",
  held: "Held back for later",
  used: "You used it",
  dismissed: "You waved it away",
};

const cardKey = (h: HistoryItem) => h.nudge.id + h.at;

/** A held card is still a live suggestion; one you have answered is only a record. */
const ACTIONABLE = (h: HistoryItem) => h.state === "held" || h.state === "shown";

/**
 * Everything JARVIS said while you were busy or away: what the server posted (a
 * scheduled task's answer, a failed backup), and the suggestions that were held
 * back by a focus timer or the quiet level — with their buttons still working.
 * Opening it marks them read when you close it, so the new ones are still
 * marked while you read.
 */
export default function InboxPanel({ open, onClose, onAction, onOpenSettings }: Props) {
  const s = useInitiative();
  const dialogRef = useDialogFocus(open);
  useEscape(open, onClose);

  // What was new when it opened stays marked until it closes.
  const [fresh, setFresh] = useState<{ history: Set<string>; server: Set<string> }>({ history: new Set(), server: new Set() });

  useEffect(() => {
    if (!open) return;
    const now = getInitiative();
    setFresh({
      history: new Set(now.history.filter((h) => !h.read).map(cardKey)),
      server: new Set(now.server.items.filter((i) => !i.read).map((i) => i.id)),
    });
    let live = true;
    // The server's unread set as it is now, not as it was when the page last looked.
    void fetchInbox().then((items) => {
      if (live && items) setFresh((f) => ({ ...f, server: new Set(items.filter((i) => !i.read).map((i) => i.id)) }));
    });
    return () => {
      live = false;
      // Read by being seen: closing it is what clears the badge.
      markHistoryRead();
      void markServerRead();
    };
  }, [open]);

  if (!open) return null;

  const empty = s.server.items.length === 0 && s.history.length === 0;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-line bg-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-title"
        data-inbox
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <h2 id="inbox-title" className="flex items-center gap-2 text-sm font-semibold">
            <Bell size={16} className="text-arc" aria-hidden />
            Inbox
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink"
              title="How much JARVIS speaks first — in Settings"
              aria-label="Initiative settings"
              data-inbox-settings
            >
              <Settings size={15} aria-hidden />
            </button>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink" title="Close" aria-label="Close">
              <X size={16} aria-hidden />
            </button>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-3">
          {empty ? (
            <p className="px-6 py-8 text-center text-[13px] leading-relaxed text-ink-faint" data-inbox-empty>
              Nothing waiting. When a scheduled task finishes, a backup fails, or a suggestion is held back while you focus, it lands here.
            </p>
          ) : (
            <div className="space-y-5">
              {s.server.items.length > 0 && (
                <section aria-labelledby="inbox-server" data-inbox-server>
                  <div className="mb-1.5 flex items-center justify-between">
                    <h3 id="inbox-server" className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
                      From JARVIS
                    </h3>
                    <button type="button" onClick={() => void clearServer()} className="text-[11px] text-ink-faint transition hover:text-ink" data-inbox-clear-server>
                      Clear these
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {s.server.items.map((item) => {
                      const Icon = item.kind === "backup" ? DatabaseBackup : CalendarClock;
                      return (
                        <li key={item.id} data-inbox-item={item.kind} className="rounded-lg border border-line bg-base px-3 py-2.5">
                          <div className="flex items-start gap-2">
                            <Icon size={14} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                                <span className="truncate">{item.title}</span>
                                {fresh.server.has(item.id) && (
                                  <span className="shrink-0 rounded-full bg-arc-solid px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">New</span>
                                )}
                              </p>
                              {item.body && <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink-dim">{item.body}</p>}
                              <p className="mt-1 text-[11px] text-ink-faint">{formatTime(item.at)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void clearServer([item.id])}
                              className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-raised hover:text-danger"
                              aria-label={`Remove “${item.title}”`}
                              title="Remove"
                            >
                              <Trash2 size={13} aria-hidden />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {s.history.length > 0 && (
                <section aria-labelledby="inbox-cards" data-inbox-cards>
                  <div className="mb-1.5 flex items-center justify-between">
                    <h3 id="inbox-cards" className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
                      Suggestions
                    </h3>
                    <button type="button" onClick={clearHistory} className="text-[11px] text-ink-faint transition hover:text-ink" data-inbox-clear-cards>
                      Clear these
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {s.history.map((h) => (
                      <li key={cardKey(h)} data-inbox-card={h.nudge.rule} data-state={h.state} className="rounded-lg border border-line bg-base px-3 py-2.5">
                        <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                          <span className="truncate">{h.nudge.title}</span>
                          {fresh.history.has(cardKey(h)) && (
                            <span className="shrink-0 rounded-full bg-arc-solid px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">New</span>
                          )}
                        </p>
                        {h.nudge.body && <p className="mt-0.5 break-words text-[12.5px] leading-relaxed text-ink-dim">{h.nudge.body}</p>}
                        {ACTIONABLE(h) && h.nudge.actions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {h.nudge.actions.map((action, i) => (
                              <button
                                key={`${action.kind}-${i}`}
                                type="button"
                                data-inbox-action={action.kind}
                                onClick={() => onAction(h.nudge, action)}
                                className="rounded-md border border-line px-2.5 py-1 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink"
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <p className="mt-1 text-[11px] text-ink-faint">
                          {STATE_LABEL[h.state]} · {formatTime(h.at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
