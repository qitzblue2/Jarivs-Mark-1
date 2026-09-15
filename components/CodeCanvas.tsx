"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Code2, Copy, Download, Eye, X } from "lucide-react";
import hljs from "highlight.js";
import Preview from "./Preview";
import { buildPreviewDocument } from "@/lib/codeblocks";
import type { Artifact } from "@/lib/types";

interface Props {
  artifacts: Artifact[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

type Tab = "code" | "preview";

export default function CodeCanvas({ artifacts, activeId, onSelect, onClose }: Props) {
  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[artifacts.length - 1] ?? null;

  const [tab, setTab] = useState<Tab>("preview");
  // Local edits, keyed by artifact id, so switching tabs doesn't lose them.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const code = active ? edits[active.id] ?? active.code : "";

  // Land on the useful tab for whatever this artifact is.
  useEffect(() => {
    if (active) setTab(active.previewable ? "preview" : "code");
  }, [active?.id, active?.previewable]);

  const highlighted = useMemo(() => {
    if (!active) return "";
    try {
      const language = hljs.getLanguage(active.lang) ? active.lang : undefined;
      return language
        ? hljs.highlight(code, { language }).value
        : hljs.highlightAuto(code).value;
    } catch {
      // Fall back to escaped plain text rather than losing the panel.
      return code.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    }
  }, [active, code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function download() {
    if (!active) return;
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = active.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex h-full flex-col border-l border-line bg-panel">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Code2 size={15} className="shrink-0 text-arc" />
        <span className="text-[13px] font-medium">Code canvas</span>
        <span className="text-[11px] text-ink-faint">
          {artifacts.length} {artifacts.length === 1 ? "block" : "blocks"}
        </span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink"
          title="Close canvas (Esc)"
        >
          <X size={15} />
        </button>
      </header>

      {artifacts.length === 0 || !active ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-[240px] text-[13px] text-ink-faint">
            <Code2 size={28} className="mx-auto mb-3 opacity-40" />
            Code JARVIS writes shows up here — editable, with a live preview for
            HTML, CSS, JS and SVG.
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-line-soft px-2 py-1.5">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => onSelect(artifact.id)}
                className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-[11px] transition ${
                  artifact.id === active.id
                    ? "bg-raised text-arc ring-1 ring-arc-dim/30"
                    : "text-ink-faint hover:bg-raised/60 hover:text-ink"
                }`}
                title={artifact.filename}
              >
                {artifact.filename}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 border-b border-line-soft px-2 py-1.5">
            <div className="flex rounded-md bg-base p-0.5">
              <button
                onClick={() => setTab("code")}
                className={`rounded px-2.5 py-1 text-[11px] transition ${
                  tab === "code" ? "bg-raised text-ink" : "text-ink-faint hover:text-ink"
                }`}
              >
                Code
              </button>
              <button
                onClick={() => setTab("preview")}
                disabled={!active.previewable}
                className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  tab === "preview" ? "bg-raised text-ink" : "text-ink-faint hover:text-ink"
                }`}
                title={active.previewable ? "Run it" : `No preview for .${active.lang}`}
              >
                <Eye size={11} />
                Preview
              </button>
            </div>

            <div className="flex-1" />

            <button
              onClick={copy}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
            >
              {copied ? <Check size={12} className="text-arc" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={download}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
            >
              <Download size={12} />
              Save
            </button>
          </div>

          <div className="min-h-0 flex-1">
            {tab === "preview" && active.previewable ? (
              <Preview doc={buildPreviewDocument({ ...active, code })} />
            ) : (
              <div className="relative h-full overflow-auto bg-[#0d1117]">
                {/* A transparent textarea over highlighted markup: editable
                    code with syntax colour, without pulling in an editor. */}
                <pre
                  aria-hidden
                  className="pointer-events-none m-0 min-h-full w-full whitespace-pre-wrap break-words p-3 font-mono text-[12.5px] leading-[1.6]"
                >
                  <code
                    className="hljs bg-transparent p-0"
                    dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }}
                  />
                </pre>
                <textarea
                  value={code}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [active.id]: e.target.value }))}
                  spellCheck={false}
                  className="absolute inset-0 h-full w-full resize-none whitespace-pre-wrap break-words bg-transparent p-3 font-mono text-[12.5px] leading-[1.6] text-transparent caret-arc outline-none"
                />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
