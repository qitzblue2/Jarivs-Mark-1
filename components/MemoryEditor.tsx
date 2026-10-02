"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, Download, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import type { MemoryEntry } from "@/lib/memory";
import { filterMemory, parseTagInput, tagCounts } from "@/lib/memory/filter";

/**
 * Everything JARVIS remembers, editable, searchable, and portable.
 *
 * Memory you can't inspect is memory you can't trust, so this is a first-class
 * part of Settings rather than a debug view.
 */

/** Per-entry controls: shown on hover or focus with a mouse, always on a touch screen. */
const REVEAL = "opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

export default function MemoryEditor({ open }: { open: boolean }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
    else {
      setQuery("");
      setTag("");
      setNote(null);
    }
  }, [open, load]);

  const tags = useMemo(() => tagCounts(entries), [entries]);
  const shown = useMemo(() => filterMemory(entries, { query, tag }), [entries, query, tag]);
  // A tag filter on a tag nobody has any more (the last entry carrying it was
  // edited or deleted) would show an empty list and no way to see why.
  useEffect(() => {
    if (tag && !tags.some((t) => t.tag === tag)) setTag("");
  }, [tags, tag]);

  async function save(text: string, tagText: string, id?: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: trimmed, tags: parseTagInput(tagText) }),
    });
    setEditingId(null);
    setAdding(false);
    setDraft("");
    setTagDraft("");
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

  async function importFile(file: File) {
    setNote(null);
    try {
      const res = await fetch("/api/memory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text(),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote({ ok: false, text: data.error ?? "That file couldn't be imported." });
        return;
      }
      const parts = [`Added ${data.added}`];
      if (data.skipped.duplicate) parts.push(`${data.skipped.duplicate} already remembered`);
      if (data.skipped.invalid) parts.push(`${data.skipped.invalid} unusable`);
      if (data.skipped.full) parts.push(`${data.skipped.full} left out — memory is full`);
      const pinned = data.pinned
        ? ` ${data.pinned} ${data.pinned === 1 ? "is" : "are"} tagged "always", which puts ${data.pinned === 1 ? "it" : "them"} in every chat — worth a look.`
        : "";
      setNote({ ok: true, text: `${parts.join(" · ")}.${pinned}` });
      await load();
    } catch {
      setNote({ ok: false, text: "That file couldn't be read." });
    }
  }

  const iconButton = "shrink-0 rounded p-0.5 text-ink-faint transition hover:text-ink";

  return (
    <section data-memory>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
          <Brain size={12} />
          Memory
        </h3>
        <span className="text-[11px] text-ink-faint" data-memory-count>
          {entries.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setDraft("");
            setTagDraft("");
          }}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-arc"
        >
          <Plus size={11} />
          Add
        </button>
        <a
          href="/api/memory/export"
          download
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-arc"
          title="Download everything remembered as a JSON file"
          data-memory-export
        >
          <Download size={11} />
          Export
        </a>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-arc"
          title="Add the entries from a memory file. Nothing already remembered is changed."
        >
          <Upload size={11} />
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Memory file to import"
          data-memory-import
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
        {entries.length > 0 &&
          (confirmClear ? (
            <span className="flex items-center gap-1">
              <button type="button" onClick={clearAll} className="rounded px-1.5 py-1 text-[11px] text-danger hover:bg-danger/15">
                Forget all
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} aria-label="Cancel" className="rounded p-1 text-ink-faint hover:text-ink">
                <X size={11} />
              </button>
            </span>
          ) : (
            <button
              type="button"
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

      <div role="status" aria-live="polite">
        {note && (
          <p
            data-memory-note
            className={`mb-2 rounded-md border px-2.5 py-1.5 text-[11.5px] leading-relaxed ${
              note.ok ? "border-ok/30 bg-ok/10 text-ok" : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            {note.text}
          </p>
        )}
      </div>

      {adding && (
        <div className="mb-2 space-y-1.5" data-memory-add>
          <div className="flex gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save(draft, tagDraft);
                if (e.key === "Escape") setAdding(false);
              }}
              autoFocus
              aria-label="Something for JARVIS to remember"
              placeholder="Something JARVIS should remember…"
              className="flex-1 rounded-md border border-arc-dim bg-base px-2.5 py-1.5 text-[12px] outline-none"
            />
            <button type="button" onClick={() => void save(draft, tagDraft)} aria-label="Save" className="rounded-md p-1.5 text-arc hover:bg-raised">
              <Check size={14} />
            </button>
          </div>
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save(draft, tagDraft);
              if (e.key === "Escape") setAdding(false);
            }}
            aria-label="Tags, separated by commas"
            placeholder="Tags, separated by commas (optional)"
            className="w-full rounded-md border border-line bg-base px-2.5 py-1 text-[11.5px] outline-none focus:border-arc-dim"
          />
        </div>
      )}

      {entries.length > 0 && (
        <div className="mb-1.5 space-y-1.5">
          <div className="relative">
            <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search memory"
              placeholder="Search memory…"
              data-memory-search
              className="w-full rounded-md border border-line bg-base py-1.5 pl-7 pr-2 text-[12px] outline-none placeholder:text-ink-faint focus:border-arc-dim"
            />
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by tag" data-memory-tags>
              {tags.map(({ tag: t, count }) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tag === t}
                  data-memory-tag={t}
                  onClick={() => setTag(tag === t ? "" : t)}
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] transition ${
                    tag === t
                      ? "border-arc-dim bg-arc-dim/15 text-ink"
                      : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"
                  }`}
                >
                  #{t} <span className="text-ink-faint">{count}</span>
                </button>
              ))}
            </div>
          )}
          {(query || tag) && (
            <p className="text-[11px] text-ink-faint" data-memory-matches>
              {shown.length} of {entries.length}
            </p>
          )}
        </div>
      )}

      <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-line-soft bg-base p-1.5" tabIndex={0} role="region" aria-label="Remembered facts">
        {loading ? (
          <p className="px-1.5 py-3 text-center text-[11.5px] text-ink-faint">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="px-1.5 py-3 text-center text-[11.5px] text-ink-faint">
            Nothing remembered yet. Tell JARVIS something about yourself.
          </p>
        ) : shown.length === 0 ? (
          <p className="px-1.5 py-3 text-center text-[11.5px] text-ink-faint">Nothing matches.</p>
        ) : (
          shown.map((entry) => (
            <div key={entry.id} className="group flex items-start gap-1.5 rounded px-1.5 py-1 hover:bg-raised/60" data-memory-entry>
              {editingId === entry.id ? (
                <>
                  <div className="min-w-0 flex-1 space-y-1">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void save(draft, tagDraft, entry.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      aria-label="Edit what is remembered"
                      className="w-full rounded border border-arc-dim bg-panel px-1.5 py-0.5 text-[11.5px] outline-none"
                    />
                    <input
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void save(draft, tagDraft, entry.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      aria-label="Tags, separated by commas"
                      placeholder="Tags, separated by commas"
                      className="w-full rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10.5px] outline-none focus:border-arc-dim"
                    />
                  </div>
                  <button type="button" onClick={() => void save(draft, tagDraft, entry.id)} aria-label="Save" className="p-0.5 text-arc">
                    <Check size={12} />
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-dim">
                    {entry.text}
                    {entry.tags.length > 0 && (
                      <span className="ml-1.5 font-mono text-[9.5px] text-arc">{entry.tags.map((t) => `#${t}`).join(" ")}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(entry.text);
                      setTagDraft(entry.tags.join(", "));
                      setEditingId(entry.id);
                    }}
                    aria-label={`Edit: ${entry.text.slice(0, 40)}`}
                    className={`${iconButton} ${REVEAL}`}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(entry.id)}
                    aria-label={`Forget: ${entry.text.slice(0, 40)}`}
                    className={`${iconButton} hover:!text-danger ${REVEAL}`}
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
