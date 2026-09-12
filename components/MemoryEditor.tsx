"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { MemoryEntry } from "@/lib/memory";

/**
 * Everything JARVIS remembers, editable.
 *
 * Memory you can't inspect is memory you can't trust, so this is a first-class
 * part of Settings rather than a debug view.
 */
export default function MemoryEditor({ open }: { open: boolean }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memory");
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function save(text: string, id?: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: trimmed }),
    });
    setEditingId(null);
    setAdding(false);
    setDraft("");
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  async function clearAll() {
    await fetch("/api/memory?all=1", { method: "DELETE" });
    setConfirmClear(false);
    await load();
  }

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
          <Brain size={12} />
          Memory
        </h3>
        <span className="text-[11px] text-ink-faint">{entries.length}</span>
        <div className="flex-1" />
        <button
          onClick={() => {
            setAdding(true);
            setDraft("");
          }}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-arc"
        >
          <Plus size={11} />
          Add
        </button>
        {entries.length > 0 &&
          (confirmClear ? (
            <span className="flex items-center gap-1">
              <button onClick={clearAll} className="rounded px-1.5 py-1 text-[11px] text-danger hover:bg-danger/15">
                Forget all
              </button>
              <button onClick={() => setConfirmClear(false)} className="rounded p-1 text-ink-faint hover:text-ink">
                <X size={11} />
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-danger"
            >
              Clear
            </button>
          ))}
      </div>

      <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
        Facts JARVIS keeps between conversations, stored in{" "}
        <code className="font-mono">data/memory.json</code>. Tag one{" "}
        <code className="font-mono">always</code> to keep it in every chat.
      </p>

      {adding && (
        <div className="mb-2 flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save(draft);
              if (e.key === "Escape") setAdding(false);
            }}
            autoFocus
            placeholder="Something JARVIS should remember…"
            className="flex-1 rounded-md border border-arc-dim bg-base px-2.5 py-1.5 text-[12px] outline-none"
          />
          <button onClick={() => void save(draft)} className="rounded-md p-1.5 text-arc hover:bg-raised">
            <Check size={14} />
          </button>
        </div>
      )}

      <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-line-soft bg-base p-1.5">
        {loading ? (
          <p className="px-1.5 py-3 text-center text-[11.5px] text-ink-faint">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="px-1.5 py-3 text-center text-[11.5px] text-ink-faint">
            Nothing remembered yet. Tell JARVIS something about yourself.
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="group flex items-start gap-1.5 rounded px-1.5 py-1 hover:bg-raised/60">
              {editingId === entry.id ? (
                <>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void save(draft, entry.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                    className="flex-1 rounded border border-arc-dim bg-panel px-1.5 py-0.5 text-[11.5px] outline-none"
                  />
                  <button onClick={() => void save(draft, entry.id)} className="p-0.5 text-arc">
                    <Check size={12} />
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-dim">
                    {entry.text}
                    {entry.tags.length > 0 && (
                      <span className="ml-1.5 font-mono text-[9.5px] text-arc/70">
                        {entry.tags.join(" · ")}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => {
                      setDraft(entry.text);
                      setEditingId(entry.id);
                    }}
                    className="shrink-0 p-0.5 text-ink-faint opacity-0 transition hover:text-ink group-hover:opacity-100"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => void remove(entry.id)}
                    className="shrink-0 p-0.5 text-ink-faint opacity-0 transition hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 size={11} />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
