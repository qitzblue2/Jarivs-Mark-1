"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, Download, GitMerge, ListPlus, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import type { MemoryEntry } from "@/lib/memory";
import { filterMemory, parseTagInput, tagCounts } from "@/lib/memory/filter";
import { dateInputOf, expiryFromDateInput, expiryLabel, findDuplicates, isExpired, mergeGroup, type DuplicateGroup } from "@/lib/memory/housekeeping";

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
  const [expiryDraft, setExpiryDraft] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [dupes, setDupes] = useState<DuplicateGroup[] | null>(null);
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
    const expires = expiryDraft ? expiryFromDateInput(expiryDraft) : null;
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // An edit always says what the expiry is, so clearing the date makes it last again.
      body: JSON.stringify({ id, text: trimmed, tags: parseTagInput(tagText), ...(id || expires ? { expires } : {}) }),
    });
    setEditingId(null);
    setAdding(false);
    setDraft("");
    setTagDraft("");
    setExpiryDraft("");
    await load();
  }

  async function addMany() {
    if (!bulkText.trim()) return;
    setNote(null);
    try {
      const res = await fetch("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bulk: bulkText }) });
      const data = await res.json();
      if (!res.ok) return setNote({ ok: false, text: data.error ?? "Those couldn't be added." });
      const s = data.skipped;
      const parts = [`Added ${data.added}`];
      if (s.duplicate) parts.push(`${s.duplicate} already remembered`);
      if (s.tooLong) parts.push(`${s.tooLong} too long`);
      if (s.overLimit) parts.push(`${s.overLimit} past the limit of 100 at a time`);
      if (s.full) parts.push(`${s.full} left out — memory is full`);
      setNote({ ok: true, text: `${parts.join(" · ")}.` });
      setBulkText("");
      setBulkOpen(false);
      await load();
    } catch {
      setNote({ ok: false, text: "Couldn't reach the server." });
    }
  }

  function checkDuplicates() {
    const found = findDuplicates(entries);
    setNote(found.length === 0 ? { ok: true, text: "No duplicates found — nothing says the same thing twice." } : null);
    setDupes(found.length ? found : null);
  }

  async function mergeOne(group: DuplicateGroup) {
    const merged = mergeGroup(group);
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: merged.id, text: merged.text, tags: merged.tags, expires: merged.expires ?? null }),
    });
    for (const extra of group.extras) await fetch(`/api/memory?id=${encodeURIComponent(extra.id)}`, { method: "DELETE" });
  }

  async function merge(groups: DuplicateGroup[]) {
    for (const g of groups) await mergeOne(g);
    const removed = groups.reduce((n, g) => n + g.extras.length, 0);
    setNote({ ok: true, text: `Merged ${removed + groups.length} entries into ${groups.length}.` });
    setDupes((prev) => {
      const left = (prev ?? []).filter((g) => !groups.includes(g));
      return left.length ? left : null;
    });
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
            setExpiryDraft("");
          }}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-arc"
        >
          <Plus size={11} />
          Add
        </button>
        <button
          type="button"
          onClick={() => setBulkOpen((v) => !v)}
          aria-expanded={bulkOpen}
          data-memory-bulk-toggle
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-arc"
          title="Add several facts at once, one per line"
        >
          <ListPlus size={11} />
          Add many
        </button>
        {entries.length > 1 && (
          <button
            type="button"
            onClick={checkDuplicates}
            data-memory-find-duplicates
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-arc"
            title="Find facts that say the same thing twice"
          >
            <GitMerge size={11} />
            Duplicates
          </button>
        )}
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

      {bulkOpen && (
        <div className="mb-2 space-y-1.5" data-memory-bulk>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            aria-label="Facts to add, one per line"
            placeholder={"One fact per line. Bullets and numbers are fine.\nAllergic to peanuts #health\nPrefers metric units"}
            data-memory-bulk-text
            className="w-full resize-y rounded-md border border-arc-dim bg-base px-2.5 py-1.5 text-[12px] leading-relaxed outline-none placeholder:text-ink-faint"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void addMany()} disabled={!bulkText.trim()} data-memory-bulk-add className="rounded-md bg-arc-solid px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-arc-solid-hover disabled:opacity-50">
              Add them
            </button>
            <span className="text-[11px] text-ink-faint">Up to 100 at a time. #tags at the end of a line become its tags; what is already remembered is skipped.</span>
          </div>
        </div>
      )}

      {dupes && (
        <div className="mb-2 space-y-1.5 rounded-md border border-line bg-base p-2" data-memory-dupes>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] text-ink-dim">
              {dupes.length} group{dupes.length === 1 ? "" : "s"} saying the same thing. Merging keeps the newest wording, everyone&apos;s tags, and removes the rest.
            </p>
            <span className="flex shrink-0 gap-1">
              <button type="button" onClick={() => void merge(dupes)} data-memory-merge-all className="rounded px-1.5 py-1 text-[11px] text-arc transition hover:bg-raised">
                Merge all
              </button>
              <button type="button" onClick={() => setDupes(null)} aria-label="Close duplicates" className="rounded p-1 text-ink-faint hover:text-ink">
                <X size={11} />
              </button>
            </span>
          </div>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto" tabIndex={0} aria-label="Groups of duplicates">
            {dupes.map((g) => (
              <li key={g.keep.id} data-memory-dupe-group className="flex items-start gap-2 rounded bg-raised/50 px-2 py-1.5">
                <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed">
                  <p className="text-ink">{g.keep.text}</p>
                  {g.extras.map((x) => (
                    <p key={x.id} className="text-ink-faint line-through decoration-ink-faint/50">
                      {x.text}
                    </p>
                  ))}
                </div>
                <button type="button" onClick={() => void merge([g])} data-memory-merge className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-ink-dim transition hover:text-ink">
                  Merge {g.extras.length + 1}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
          <label className="flex items-center gap-2 text-[11.5px] text-ink-dim">
            Forget after
            <input
              type="date"
              value={expiryDraft}
              onChange={(e) => setExpiryDraft(e.target.value)}
              aria-label="Stop using this after (optional)"
              data-memory-expiry
              className="rounded-md border border-line bg-base px-2 py-0.5 text-[11.5px] outline-none focus:border-arc-dim"
            />
            <span className="text-ink-faint">(optional)</span>
          </label>
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
                    <label className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
                      Forget after
                      <input
                        type="date"
                        value={expiryDraft}
                        onChange={(e) => setExpiryDraft(e.target.value)}
                        aria-label="Stop using this after (optional)"
                        data-memory-expiry
                        className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10.5px] outline-none focus:border-arc-dim"
                      />
                    </label>
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
                    {expiryLabel(entry) && (
                      <span
                        data-memory-expiry-label={isExpired(entry) ? "expired" : "pending"}
                        title={isExpired(entry) ? "No longer given to the model. Edit it to extend, or forget it." : "After this date it is no longer given to the model."}
                        className={`ml-1.5 text-[10px] ${isExpired(entry) ? "text-warn" : "text-ink-faint"}`}
                      >
                        ({expiryLabel(entry)})
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(entry.text);
                      setTagDraft(entry.tags.join(", "));
                      setExpiryDraft(dateInputOf(entry.expires));
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
