"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw, Trash2, Upload } from "lucide-react";
import { formatBytes, relativeTime } from "@/lib/format";

/** Tell the rest of the page that the list of chats changed under it. */
export const CHATS_CHANGED = "jarvis:chats-changed";

interface Usage {
  rows: { id: string; label: string; bytes: number; files: number }[];
  totalBytes: number;
  dir: string;
  disk: { free: number; total: number } | null;
  largest: { id: string; title: string; bytes: number; messages: number; updatedAt: number }[];
}

/**
 * Where the disk space goes: each kind of thing JARVIS keeps, and the chats that
 * take the most — with a way to move one to the trash from here. The chats are
 * the only part you can sensibly shrink by hand; pictures are managed in the
 * gallery and backups prune themselves.
 */
function StorageView() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/storage?largest=8", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "Couldn't measure it.");
      setUsage(data);
      setError(null);
    } catch {
      setError("Couldn't reach the server.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function trash(id: string) {
    setConfirm(null);
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    window.dispatchEvent(new Event(CHATS_CHANGED));
    await load();
  }

  const max = Math.max(1, ...(usage?.rows.map((r) => r.bytes) ?? [1]));

  return (
    <div className="space-y-2" data-storage>
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Storage</h4>
        <button type="button" onClick={() => void load()} aria-label="Measure again" title="Measure again" className="rounded p-1 text-ink-faint transition hover:text-ink">
          <RefreshCw size={12} aria-hidden />
        </button>
      </div>
      {error && <p className="text-[12px] text-warn">{error}</p>}
      {!usage && !error && <p className="text-[12px] text-ink-faint">Measuring…</p>}
      {usage && (
        <>
          <ul className="space-y-1.5" aria-label="Space used">
            {usage.rows.map((r) => (
              <li key={r.id} data-storage-row={r.id}>
                <div className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="text-ink-dim">{r.label}</span>
                  <span className="shrink-0 font-mono text-ink" data-storage-bytes>
                    {formatBytes(r.bytes)}
                    <span className="ml-1.5 text-ink-faint">{r.files} file{r.files === 1 ? "" : "s"}</span>
                  </span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded bg-raised" aria-hidden>
                  <div className="h-full rounded bg-arc-dim" style={{ width: `${Math.max(r.bytes > 0 ? 2 : 0, (r.bytes / max) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-ink-faint" data-storage-total>
            {formatBytes(usage.totalBytes)} in <code className="font-mono">{usage.dir.split("/").slice(-2).join("/")}</code>
            {usage.disk ? ` · ${formatBytes(usage.disk.free)} free on this disk` : ""}
          </p>
          {usage.largest.length > 0 && (
            <div>
              <h4 className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Biggest chats</h4>
              <ul className="space-y-1" aria-label="Biggest chats">
                {usage.largest.map((c) => (
                  <li key={c.id} data-storage-chat={c.id} className="flex items-center gap-2 rounded-md border border-line-soft px-2 py-1.5 text-[12px]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{c.title}</span>
                      <span className="block text-[11px] text-ink-faint">
                        {c.messages} messages · {relativeTime(c.updatedAt)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-ink-dim">{formatBytes(c.bytes)}</span>
                    {confirm === c.id ? (
                      <span className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => void trash(c.id)} data-storage-confirm className="rounded px-1.5 py-0.5 text-[11px] text-danger hover:bg-danger/15">
                          Move to trash
                        </button>
                        <button type="button" onClick={() => setConfirm(null)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-ink">
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirm(c.id)}
                        aria-label={`Move “${c.title}” to the trash`}
                        title="Move to the trash — it can be restored for 30 days"
                        data-storage-trash
                        className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-raised hover:text-danger"
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Moving your conversations in and out: every chat as Markdown files, or one
 * chat brought in from a JARVIS export. (Backing up and restoring JARVIS
 * itself is Back up / Restore under the chat list.)
 */
export default function DataSettings() {
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function importFile(f: File) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/chats/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: await f.text() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setNote(data.error ?? "That file couldn't be imported.");
      setNote(`Imported “${data.chat.title}” — ${data.chat.messages} messages${data.skipped ? `, ${data.skipped} skipped` : ""}. It is in the chat list.`);
      window.dispatchEvent(new Event(CHATS_CHANGED));
    } catch {
      setNote("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2.5" data-data-settings>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">Your chats, in and out</h3>
      <div className="flex flex-wrap gap-2">
        <a
          href="/api/export/markdown"
          download
          data-export-markdown
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink"
        >
          <Download size={13} aria-hidden /> Every chat as Markdown (zip)
        </a>
        <button
          type="button"
          disabled={busy}
          onClick={() => file.current?.click()}
          data-import-chat
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink disabled:opacity-50"
        >
          <Upload size={13} aria-hidden /> Import a chat (.json)
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="hidden"
          data-import-file
          aria-label="Chat file to import"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        Import takes a file from a chat&apos;s <em>Export as JSON</em> (<code className="font-mono">/api/chats/&lt;id&gt;/export?format=json</code>). It always adds a new chat; nothing you have is replaced.
      </p>
      {note && (
        <p role="status" className="text-[12px] text-ink-dim" data-data-note>
          {note}
        </p>
      )}
      <StorageView />
    </section>
  );
}
