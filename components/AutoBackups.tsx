"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Download } from "lucide-react";

interface Status {
  enabled: boolean;
  keep: number;
  includesImages: boolean;
  folder: string;
  backups: { name: string; size: number; at: number }[];
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "jarvis-auto-2026-10-02.zip" → "2026-10-02": the name carries the day. */
const dayOf = (name: string) => name.replace(/^jarvis-auto-/, "").replace(/\.zip$/, "");

/**
 * The daily backups: whether they are on, what is there, and a button for one now.
 * Restoring is the **Restore** link in the sidebar, which takes any backup zip.
 */
export default function AutoBackups({ open }: { open: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await (await fetch("/api/backup/auto")).json());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    else setNote(null);
  }, [open, load]);

  async function backUpNow() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/backup/auto", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) setNote({ ok: false, text: data.error ?? "The backup failed." });
      else setNote({ ok: true, text: `Saved ${data.created}.${data.pruned?.length ? ` Removed ${data.pruned.length} older.` : ""}` });
      if (data.backups) setStatus(data);
      else await load();
    } catch {
      setNote({ ok: false, text: "The backup failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-auto-backups>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
          <Archive size={12} aria-hidden />
          Backups
        </h3>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void backUpNow()}
          disabled={busy}
          data-backup-now
          className="rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-arc disabled:opacity-50"
        >
          {busy ? "Backing up…" : "Back up now"}
        </button>
      </div>

      <p className="mb-2 text-[11px] leading-relaxed text-ink-faint" data-backup-status>
        {status === null
          ? "Loading…"
          : status.enabled
            ? `A backup is made once a day and the last ${status.keep} kept, in `
            : "Daily backups are off (JARVIS_AUTO_BACKUP=0). "}
        {status?.enabled && <code className="font-mono">{status.folder}</code>}
        {status?.enabled && (status.includesImages ? ", pictures included." : ", without pictures.")}
        {" "}
        Restore one with <strong className="font-medium">Restore</strong> in the chat list&apos;s footer. A backup beside the data
        doesn&apos;t survive losing the disk; <code className="font-mono">JARVIS_BACKUP_DIR</code> can point somewhere else.
      </p>

      <div role="status" aria-live="polite">
        {note && (
          <p
            data-backup-note
            className={`mb-2 rounded-md border px-2.5 py-1.5 text-[11.5px] ${note.ok ? "border-ok/30 bg-ok/10 text-ok" : "border-danger/30 bg-danger/10 text-danger"}`}
          >
            {note.text}
          </p>
        )}
      </div>

      {status && status.backups.length > 0 && (
        <ul className="space-y-1 rounded-md border border-line-soft bg-base p-1.5" data-backup-list>
          {status.backups.map((b) => (
            <li key={b.name} className="flex items-center gap-2 px-1.5 py-1 text-[11.5px] text-ink-dim" data-backup={b.name}>
              <span className="font-mono">{dayOf(b.name)}</span>
              <span className="text-ink-faint">{size(b.size)}</span>
              <span className="flex-1" />
              <a
                href={`/api/backup/auto/${b.name}`}
                download
                className="flex items-center gap-1 text-ink-faint transition hover:text-arc"
                aria-label={`Download the backup from ${dayOf(b.name)}`}
              >
                <Download size={11} aria-hidden /> Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
