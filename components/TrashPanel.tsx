"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";

interface Trashed {
  id: string;
  title: string;
  deletedAt: number;
  messageCount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** A chat was put back — the sidebar needs to reload. */
  onRestored: () => void;
}

const DAY = 24 * 60 * 60 * 1000;

function ago(at: number): string {
  const days = Math.floor((Date.now() - at) / DAY);
  if (days < 1) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Deleted chats, recoverable for 30 days. */
export default function TrashPanel({ open, onClose, onRestored }: Props) {
  const [items, setItems] = useState<Trashed[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEscape(open, onClose);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trash");
      const data = await res.json();
      setItems(data.chats ?? []);
    } catch {
      setNote("Couldn't load the trash.");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  async function restore(id: string) {
    const res = await fetch("/api/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setItems((all) => (all ?? []).filter((c) => c.id !== id));
      onRestored();
    } else setNote("Couldn't restore that chat.");
  }

  async function purge(id: string) {
    if (!confirm("Delete this chat for good? This can't be undone.")) return;
    const res = await fetch(`/api/trash?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) setItems((all) => (all ?? []).filter((c) => c.id !== id));
    else setNote("Couldn't delete that chat.");
  }

  async function empty() {
    if (!confirm(`Delete all ${items?.length} chats in the trash for good? This can't be undone.`)) return;
    const res = await fetch("/api/trash?all=1", { method: "DELETE" });
    if (res.ok) setItems([]);
    else setNote("Couldn't empty the trash.");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-line bg-panel shadow-2xl"
        role="dialog"
        aria-label="Trash"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Trash2 size={16} className="text-arc" />
            Trash
            <span className="text-[11px] font-normal text-ink-faint">deleted chats are kept for 30 days</span>
          </div>
          <div className="flex items-center gap-1">
            {items && items.length > 0 && (
              <button onClick={() => void empty()} className="rounded-md px-2 py-1 text-[12px] text-ink-dim hover:text-danger">
                Empty trash
              </button>
            )}
            <button onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink" title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {note && <p className="border-b border-line-soft px-4 py-2 text-[12px] text-warn">{note}</p>}

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {items === null ? (
            <p className="py-8 text-center text-[13px] text-ink-faint">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-faint">The trash is empty.</p>
          ) : (
            <ul data-trash-list>
              {items.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-raised/60">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink">{c.title}</div>
                    <div className="text-[11px] text-ink-faint">
                      deleted {ago(c.deletedAt)} · {c.messageCount} msg
                    </div>
                  </div>
                  <button
                    onClick={() => void restore(c.id)}
                    className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-ink-dim hover:text-arc"
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                  <button
                    onClick={() => void purge(c.id)}
                    className="rounded-md p-1.5 text-ink-faint hover:bg-line hover:text-danger"
                    title="Delete for good"
                  >
                    <Trash2 size={13} />
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
