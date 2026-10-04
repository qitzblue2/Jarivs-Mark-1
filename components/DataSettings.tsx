"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";

/** Tell the rest of the page that the list of chats changed under it. */
export const CHATS_CHANGED = "jarvis:chats-changed";

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
    </section>
  );
}
