"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileCode2,
  FlaskConical,
  GitCompare,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import DiffView from "./DiffView";
import { useEscape } from "@/lib/hooks/use-escape";

interface Change {
  path: string;
  status: "modified" | "added" | "deleted";
  conflict: boolean;
}

interface CheckStep {
  name: string;
  ok: boolean;
  skipped?: boolean;
  ms: number;
  output: string;
}

interface Status {
  server: {
    state: "disabled" | "starting" | "online" | "restarting" | "stopped";
    port: number;
    host: string;
    restarts: number;
    lastExit: string | null;
    logs: string[];
  };
  changes: Change[];
  history: { id: string; at: number; files: { path: string; status: string }[]; undoneAt?: number }[];
  check: { ok: boolean; at: number; steps: CheckStep[]; current: boolean } | null;
}

interface OpenFile {
  path: string;
  /** What's saved in the sandbox. */
  saved: string;
  /** What's in the editor. */
  draft: string;
  live: string | null;
  editable: boolean;
  diff: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_LETTER = { modified: "M", added: "A", deleted: "D" } as const;
const STATUS_TONE = { modified: "text-warn", added: "text-emerald-300", deleted: "text-danger" } as const;

/**
 * JARVIS' code, in a copy you can break.
 *
 * Everything here edits the sandbox — a second JARVIS that is always running
 * beside the real one — and nothing reaches the real one until Apply, which
 * checks the code first and keeps a backup so it can be undone.
 */
export default function SandboxPanel({ open, onClose }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [files, setFiles] = useState<{ path: string; editable: boolean }[]>([]);
  const [filter, setFilter] = useState("");
  const [file, setFile] = useState<OpenFile | null>(null);
  const [view, setView] = useState<"edit" | "diff">("edit");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<"files" | "editor" | "changes">("files");
  const [showLog, setShowLog] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);

  const dirty = file !== null && file.draft !== file.saved;

  useEscape(open, () => {
    if (!dirty || confirm("Close without saving your changes to this file?")) onClose();
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sandbox");
      const data = await res.json();
      if (data.error) setNote({ tone: "error", text: data.error });
      else setStatus(data);
    } catch {
      /* next poll will try again */
    }
  }, []);

  const loadFiles = useCallback(async () => {
    const res = await fetch("/api/sandbox/files");
    const data = await res.json();
    if (Array.isArray(data.files)) setFiles(data.files);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    void loadFiles();
    // The sandbox's own state moves on its own — a restart, a compile — so poll while open.
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [open, refresh, loadFiles]);

  const openFile = useCallback(
    async (path: string, as: "edit" | "diff" = "edit") => {
      if (dirty && !confirm("Discard your unsaved changes to this file?")) return;
      const res = await fetch(`/api/sandbox/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) {
        setNote({ tone: "error", text: data.error });
        return;
      }
      const saved = data.sandbox ?? "";
      setFile({ path: data.path, saved, draft: saved, live: data.live, editable: data.editable, diff: data.diff });
      setView(data.sandbox === null ? "diff" : as);
      setTab("editor");
    },
    [dirty],
  );

  const save = useCallback(async () => {
    if (!file || !file.editable || !dirty) return;
    setBusy("save");
    try {
      const res = await fetch("/api/sandbox/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, content: file.draft }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const fresh = await (await fetch(`/api/sandbox/file?path=${encodeURIComponent(file.path)}`)).json();
      setFile((f) => (f ? { ...f, saved: f.draft, diff: fresh.diff ?? "" } : f));
      setNote({ tone: "ok", text: `Saved ${file.path} to the sandbox — it's running there now.` });
      void refresh();
      void loadFiles();
    } catch (err) {
      setNote({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }, [file, dirty, refresh, loadFiles]);

  async function act(action: string, extra: Record<string, unknown> = {}, label = action) {
    setBusy(label);
    setNote(null);
    try {
      const res = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote({ tone: "error", text: data.error ?? "That didn't work." });
        return data;
      }
      return data;
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  async function apply(force = false) {
    if (force && !confirm("The checks failed. Apply to JARVIS anyway? You can undo it afterwards.")) return;
    const data = await act("apply", { force }, "apply");
    if (data?.promotion) {
      setNote({ tone: "ok", text: `Applied ${data.promotion.files.length} file(s) to JARVIS. ${data.note}` });
      if (file) void openFile(file.path, view);
    }
  }

  async function newFile() {
    const path = prompt('New file path, e.g. "lib/tools/my-tool.ts"');
    if (!path) return;
    const res = await fetch("/api/sandbox/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: "" }),
    });
    const data = await res.json();
    if (data.error) setNote({ tone: "error", text: data.error });
    else {
      await loadFiles();
      await openFile(data.rel);
    }
  }

  const changed = useMemo(() => new Map((status?.changes ?? []).map((c) => [c.path, c])), [status]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  }, [files, filter]);

  if (!open) return null;

  const server = status?.server;
  const online = server?.state === "online";
  const sandboxUrl =
    typeof window !== "undefined" && server ? `${window.location.protocol}//${window.location.hostname}:${server.port}` : "#";
  const check = status?.check;
  const changes = status?.changes ?? [];
  const conflicts = changes.filter((c) => c.conflict).length;
  const failedNow = check?.current && !check.ok;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base" role="dialog" aria-label="Sandbox">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <FlaskConical size={16} className="text-arc" />
        <span className="text-sm font-semibold">Sandbox</span>
        <span
          className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ${
            online ? "bg-emerald-500/10 text-emerald-300" : server?.state === "stopped" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"
          }`}
          data-sandbox-state={server?.state ?? "unknown"}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : server?.state === "stopped" ? "bg-danger" : "animate-pulse bg-warn"}`} />
          {!server ? "…" : online ? "Online" : server.state === "stopped" ? "Offline" : server.state === "starting" ? "Starting…" : "Restarting…"}
          {server && server.restarts > 0 && <span className="text-ink-faint">· restarted {server.restarts}×</span>}
        </span>
        <span className="hidden text-[11px] text-ink-faint md:inline">
          A copy of JARVIS you can change freely. The real one is untouched until you apply.
        </span>
        <div className="ml-auto flex items-center gap-1">
          <a
            href={sandboxUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-ink-dim hover:text-arc"
            title="Open the sandbox JARVIS in a new tab"
          >
            <ExternalLink size={13} /> Open sandbox
          </a>
          <button
            onClick={() => void act("restart", {}, "restart")}
            disabled={busy !== null}
            className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink disabled:opacity-40"
            title="Restart the sandbox server"
          >
            <RefreshCw size={15} className={busy === "restart" ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => {
              if (confirm("Reset the sandbox to a fresh copy of JARVIS? Unapplied changes are lost.")) {
                setFile(null);
                void act("reset", {}, "reset").then(() => loadFiles());
              }
            }}
            disabled={busy !== null}
            className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-danger disabled:opacity-40"
            title="Reset the sandbox to match JARVIS"
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={() => {
              if (!dirty || confirm("Close without saving your changes to this file?")) onClose();
            }}
            className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {note && (
        <div
          className={`flex items-start gap-2 border-b border-line-soft px-3 py-1.5 text-[12px] ${
            note.tone === "ok" ? "text-emerald-300" : note.tone === "warn" ? "text-warn" : "text-danger"
          }`}
          role="status"
        >
          <span className="min-w-0 flex-1">{note.text}</span>
          <button onClick={() => setNote(null)} className="text-ink-faint hover:text-ink">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Tabs, on narrow screens only */}
      <div className="flex border-b border-line-soft lg:hidden">
        {(["files", "editor", "changes"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[12px] capitalize ${tab === t ? "border-b-2 border-arc text-arc" : "text-ink-dim"}`}
          >
            {t === "changes" ? `Changes (${changes.length})` : t}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Files */}
        <aside className={`${tab === "files" ? "flex" : "hidden"} w-full flex-col border-r border-line bg-panel lg:flex lg:w-64 lg:shrink-0`}>
          <div className="flex items-center gap-1.5 p-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line-soft bg-base px-2 py-1">
              <Search size={12} className="shrink-0 text-ink-faint" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find a file"
                className="w-full bg-transparent text-[12px] outline-none placeholder:text-ink-faint"
              />
            </div>
            <button onClick={() => void newFile()} className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim hover:text-arc" title="Add a new file">
              + New
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto pb-2 font-mono text-[11.5px]">
            {visible.map((f) => {
              const c = changed.get(f.path);
              const slash = f.path.lastIndexOf("/");
              return (
                <li key={f.path}>
                  <button
                    onClick={() => void openFile(f.path)}
                    className={`flex w-full items-center gap-1.5 px-2 py-0.5 text-left hover:bg-raised ${file?.path === f.path ? "bg-raised text-ink" : "text-ink-dim"}`}
                    title={f.path}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-ink-faint">{slash >= 0 ? f.path.slice(0, slash + 1) : ""}</span>
                      {f.path.slice(slash + 1)}
                    </span>
                    {c && <span className={`shrink-0 font-bold ${STATUS_TONE[c.status]}`}>{STATUS_LETTER[c.status]}</span>}
                    {!f.editable && <span className="shrink-0 text-[9px] text-ink-faint">read-only</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Editor */}
        <main className={`${tab === "editor" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}>
          {!file ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-ink-faint">
              <FileCode2 size={28} />
              <p>Pick any file of JARVIS to read or change it.</p>
              <p className="max-w-md text-[12px]">
                Or ask JARVIS in a chat — &ldquo;add a tool that tells jokes&rdquo; — and approve its edits.
                Either way they land here first.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-1.5">
                <code className="min-w-0 truncate text-[12px] text-ink" data-open-file={file.path}>{file.path}</code>
                {file.live === null && <span className="rounded bg-emerald-500/10 px-1.5 text-[10px] text-emerald-300">new</span>}
                {file.live !== null && file.saved !== file.live && <span className="rounded bg-warn/10 px-1.5 text-[10px] text-warn">changed</span>}
                {dirty && <span className="text-[10px] text-warn">● unsaved</span>}
                {!file.editable && <span className="text-[10px] text-ink-faint">read-only</span>}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => setView(view === "edit" ? "diff" : "edit")}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-dim hover:bg-raised hover:text-ink"
                    title="Compare with the real JARVIS"
                  >
                    <GitCompare size={13} /> {view === "edit" ? "Diff" : "Edit"}
                  </button>
                  {file.editable && (file.saved !== file.live) && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Put ${file.path} back the way JARVIS has it?`)) return;
                        await act("revert", { path: file.path }, "revert");
                        await loadFiles();
                        await openFile(file.path);
                      }}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-dim hover:bg-raised hover:text-ink"
                    >
                      <Undo2 size={13} /> Revert
                    </button>
                  )}
                  {file.editable && (
                    <button
                      onClick={() => void save()}
                      disabled={!dirty || busy !== null}
                      className="flex items-center gap-1 rounded-md bg-arc-dim px-2.5 py-1 text-[12px] font-medium text-white hover:bg-arc disabled:opacity-40"
                      title="Save to the sandbox (Ctrl+S)"
                    >
                      <Save size={13} /> Save
                    </button>
                  )}
                </div>
              </div>
              {view === "diff" ? (
                <DiffView diff={file.diff} className="min-h-0 flex-1 py-2" />
              ) : (
                <textarea
                  ref={editor}
                  value={file.draft}
                  readOnly={!file.editable}
                  spellCheck={false}
                  onChange={(e) => setFile({ ...file, draft: e.target.value })}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                      e.preventDefault();
                      void save();
                    }
                    // Tab indents rather than leaving the editor.
                    if (e.key === "Tab" && !e.shiftKey && file.editable) {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const { selectionStart: a, selectionEnd: b } = el;
                      const next = `${file.draft.slice(0, a)}  ${file.draft.slice(b)}`;
                      setFile({ ...file, draft: next });
                      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
                    }
                  }}
                  className="min-h-0 flex-1 resize-none bg-base p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none"
                  aria-label={`Editing ${file.path}`}
                />
              )}
            </>
          )}
        </main>

        {/* Changes, checks, apply, history */}
        <aside className={`${tab === "changes" ? "flex" : "hidden"} w-full flex-col overflow-y-auto border-l border-line bg-panel lg:flex lg:w-80 lg:shrink-0`}>
          <section className="border-b border-line-soft p-3">
            <h3 className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">
              Waiting to apply ({changes.length})
            </h3>
            {changes.length === 0 ? (
              <p className="text-[12px] text-ink-faint">The sandbox matches JARVIS.</p>
            ) : (
              <ul className="space-y-0.5 font-mono text-[11.5px]">
                {changes.map((c) => (
                  <li key={c.path}>
                    <button
                      onClick={() => void openFile(c.path, "diff")}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-ink-dim hover:bg-raised hover:text-ink"
                    >
                      <span className={`w-3 shrink-0 font-bold ${STATUS_TONE[c.status]}`}>{STATUS_LETTER[c.status]}</span>
                      <span className="min-w-0 flex-1 truncate">{c.path}</span>
                      {c.conflict && <AlertTriangle size={12} className="shrink-0 text-danger" aria-label="changed in JARVIS too" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {conflicts > 0 && (
              <p className="mt-2 text-[11px] text-danger">
                {conflicts} file{conflicts === 1 ? " was" : "s were"} changed in JARVIS since the sandbox copied
                {conflicts === 1 ? " it" : " them"}. Revert or reset before applying.
              </p>
            )}
          </section>

          <section className="border-b border-line-soft p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10px] uppercase tracking-widest text-ink-faint">Checks</h3>
              <button
                onClick={() => void act("check", {}, "check")}
                disabled={busy !== null}
                className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-dim hover:text-arc disabled:opacity-40"
              >
                {busy === "check" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                {busy === "check" ? "Running…" : "Run checks"}
              </button>
            </div>
            {!check ? (
              <p className="text-[12px] text-ink-faint">Type check and unit tests run before anything is applied.</p>
            ) : (
              <ul className="space-y-1 text-[12px]" data-check={check.ok ? "passed" : "failed"}>
                {check.steps.map((step) => (
                  <li key={step.name}>
                    <details>
                      <summary className={`cursor-pointer ${step.skipped ? "text-ink-faint" : step.ok ? "text-emerald-300" : "text-danger"}`}>
                        {step.skipped ? "–" : step.ok ? "✓" : "✗"} {step.name}
                        <span className="text-ink-faint"> · {(step.ms / 1000).toFixed(1)}s</span>
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-base p-2 font-mono text-[10.5px] text-ink-dim">
                        {step.output || "(no output)"}
                      </pre>
                    </details>
                  </li>
                ))}
                {!check.current && changes.length > 0 && (
                  <li className="text-[11px] text-warn">The sandbox changed since — run them again.</li>
                )}
              </ul>
            )}
          </section>

          <section className="border-b border-line-soft p-3">
            <button
              onClick={() => void apply(false)}
              disabled={busy !== null || changes.length === 0 || conflicts > 0}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-arc-dim px-3 py-2 text-[12.5px] font-medium text-white hover:bg-arc disabled:opacity-40"
            >
              {busy === "apply" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {busy === "apply" ? "Checking and applying…" : `Apply ${changes.length || ""} change${changes.length === 1 ? "" : "s"} to JARVIS`}
            </button>
            {failedNow && changes.length > 0 && conflicts === 0 && (
              <button
                onClick={() => void apply(true)}
                disabled={busy !== null}
                className="mt-1.5 w-full text-center text-[11px] text-danger hover:underline"
              >
                Checks failed — apply anyway
              </button>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Runs the checks, saves JARVIS&apos; current files, then copies the sandbox&apos;s changes in.
              Every apply can be undone below.
            </p>
          </section>

          <section className="border-b border-line-soft p-3">
            <h3 className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">Applied</h3>
            {(status?.history ?? []).length === 0 ? (
              <p className="text-[12px] text-ink-faint">Nothing applied yet.</p>
            ) : (
              <ul className="space-y-2 text-[12px]">
                {status!.history.map((h) => (
                  <li key={h.id} className="rounded border border-line-soft p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-dim">{new Date(h.at).toLocaleString()}</span>
                      {h.undoneAt ? (
                        <span className="text-[11px] text-ink-faint">undone</span>
                      ) : (
                        <button
                          onClick={async () => {
                            if (!confirm("Put JARVIS' files back the way they were before this?")) return;
                            const data = await act("undo", { id: h.id }, "undo");
                            if (data?.promotion) setNote({ tone: "ok", text: `Undone. ${data.note}` });
                          }}
                          disabled={busy !== null}
                          className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-dim hover:text-warn disabled:opacity-40"
                        >
                          <Undo2 size={11} /> Undo
                        </button>
                      )}
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-ink-faint" title={h.files.map((f) => f.path).join(", ")}>
                      {h.files.map((f) => f.path).join(", ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="p-3">
            <button onClick={() => setShowLog((v) => !v)} className="text-[11px] text-ink-faint hover:text-ink">
              {showLog ? "Hide" : "Show"} sandbox server log
            </button>
            {showLog && (
              <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-base p-2 font-mono text-[10.5px] text-ink-dim">
                {(server?.logs ?? []).join("\n") || "(nothing yet)"}
              </pre>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
