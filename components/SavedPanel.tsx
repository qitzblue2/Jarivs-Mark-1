"use client";

import { useEffect, useState } from "react";
import { Star, X } from "lucide-react";
import { formatTime } from "@/lib/format";
import { useEscape } from "@/lib/hooks/use-escape";
import type { StarredItem } from "@/lib/starred";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Open the chat a saved message is in, scrolled to it. */
  onOpen: (chatId: string, messageId: string) => void;
}

/** Every message you've starred, from every chat, newest first. */
export default function SavedPanel({ open, onClose, onOpen }: Props) {
  const [items, setItems] = useState<StarredItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setItems(null);
    fetch("/api/starred")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else {
          setError(null);
          setItems(data.items ?? []);
        }
      })
      .catch(() => !cancelled && setError("Couldn't load your saved messages."));
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-line bg-panel shadow-2xl"
        role="dialog"
        aria-label="Saved messages"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Star size={16} className="fill-warn text-warn" />
            Saved
            {items && <span className="text-[11px] font-normal text-ink-faint">{items.length}</span>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink" title="Close">
            <X size={16} />
          </button>
        </div>

        {error && <p className="border-b border-line-soft px-4 py-2 text-[12px] text-warn">{error}</p>}

        <div className="max-h-[65vh] overflow-y-auto p-2">
          {items === null && !error ? (
            <p className="py-8 text-center text-[13px] text-ink-faint">Loading…</p>
          ) : items && items.length === 0 ? (
            <p className="px-6 py-8 text-center text-[13px] leading-relaxed text-ink-faint">
              Nothing saved yet. Hover over any message and press <strong>Save</strong> to keep it here.
            </p>
          ) : (
            <ul data-saved-list>
              {items?.map((item) => (
                <li key={`${item.chatId}-${item.messageId}`}>
                  <button
                    onClick={() => onOpen(item.chatId, item.messageId)}
                    className="block w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-raised/70"
                  >
                    <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                      <span className="truncate font-medium text-ink-dim">{item.chatTitle}</span>
                      <span>·</span>
                      <span>{item.role === "user" ? "you" : (item.model ?? "JARVIS")}</span>
                      <span className="ml-auto shrink-0">{formatTime(item.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-ink">{item.preview}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
