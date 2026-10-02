"use client";

import { memo, useRef, useState, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, Download, Maximize2, PanelRightOpen, Table2, WrapText } from "lucide-react";
import { codeFileName } from "@/lib/codeblocks";
import { toCsv } from "@/lib/csv";
import Lightbox, { isOwnImage } from "./Lightbox";

interface Props {
  content: string;
  /** Opens the matching block in the code canvas. */
  onOpenInCanvas?: (index: number) => void;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure origin) — fail quietly */
    }
  }

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-dim transition hover:bg-line hover:text-ink"
      title={label}
    >
      {copied ? <Check size={12} className="text-arc" /> : <Copy size={12} />}
      {copied ? "Copied" : label}
    </button>
  );
}

/** Flatten a node tree back to plain text so we can copy the raw source. */
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  const el = node as { props?: { children?: ReactNode } };
  return el?.props?.children ? nodeText(el.props.children) : "";
}

/**
 * A picture in a reply: shown at a readable size, enlarged on click, and —
 * for ones JARVIS made — downloadable without leaving the chat.
 */
function ChatImage({ src, alt }: { src?: string; alt?: string }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!src) return null;

  if (broken) {
    return (
      <span className="my-2 inline-block rounded-lg border border-line px-3 py-2 text-[12px] text-ink-faint">
        Picture unavailable{alt ? `: ${alt}` : ""} — it may have been deleted.
      </span>
    );
  }

  return (
    <span className="group/img relative my-2 inline-block max-w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        onError={() => setBroken(true)}
        onClick={() => setOpen(true)}
        className="max-h-[420px] max-w-full cursor-zoom-in rounded-lg border border-line"
      />
      <span className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover/img:opacity-100">
        <button
          onClick={() => setOpen(true)}
          className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
          title="Enlarge"
        >
          <Maximize2 size={13} />
        </button>
        {isOwnImage(src) && (
          <a
            href={`${src}?download=1`}
            className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
            title="Download"
          >
            <Download size={13} />
          </a>
        )}
      </span>
      {open && <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </span>
  );
}

/** The language a highlighted block was written in, from its `language-xxx` class. */
function languageOf(children: ReactNode): string {
  const first = (Array.isArray(children) ? children[0] : children) as ReactElement<{ className?: string }> | undefined;
  return /language-([\w+#.-]+)/.exec(first?.props?.className ?? "")?.[1] ?? "text";
}

/** Save text as a file in the browser, with no server involved. */
function saveAs(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const toolButton =
  "flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-dim transition hover:bg-line hover:text-ink";

/** A fenced code block: copy, download as a file, wrap long lines, open in the canvas. */
function CodeBlock({
  children,
  index,
  onOpenInCanvas,
}: {
  children: ReactNode;
  index: number;
  onOpenInCanvas?: (index: number) => void;
}) {
  const [wrap, setWrap] = useState(false);
  const source = nodeText(children);
  const lang = languageOf(children);

  return (
    <div className="group my-3 overflow-hidden rounded-lg border border-line bg-[#0d1117]" data-code-block>
      <div className="flex items-center justify-between border-b border-line-soft bg-panel px-2 py-1">
        <span className="font-mono text-[11px] text-ink-faint">{lang === "text" ? "code" : lang}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWrap((w) => !w)}
            className={`${toolButton} ${wrap ? "text-arc" : ""}`}
            title={wrap ? "Stop wrapping long lines" : "Wrap long lines"}
            aria-pressed={wrap}
          >
            <WrapText size={12} />
            Wrap
          </button>
          <button
            onClick={() => saveAs(codeFileName(source, lang), source)}
            className={toolButton}
            title={`Download as ${codeFileName(source, lang)}`}
            data-code-download
          >
            <Download size={12} />
            Download
          </button>
          {onOpenInCanvas && (
            <button onClick={() => onOpenInCanvas(index)} className={`${toolButton} hover:text-arc`} title="Open in code canvas">
              <PanelRightOpen size={12} />
              Canvas
            </button>
          )}
          <CopyButton text={source} />
        </div>
      </div>
      {/* Must stay a real <pre>: swapping it for a div drops
          white-space: pre and collapses every newline. */}
      <pre className={`m-0 p-3 ${wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto"}`}>{children}</pre>
    </div>
  );
}

/** A table, scrollable when wide, with its contents copyable as CSV for a spreadsheet. */
function TableBlock({ children }: { children: ReactNode }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  async function copyCsv() {
    const rows = [...(wrapper.current?.querySelectorAll("tr") ?? [])].map((tr) =>
      [...tr.querySelectorAll("th, td")].map((cell) => (cell.textContent ?? "").trim()),
    );
    try {
      await navigator.clipboard.writeText(toCsv(rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure origin) */
    }
  }

  return (
    <div className="group/table relative my-3" ref={wrapper}>
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
      <button
        onClick={() => void copyCsv()}
        className="absolute -top-2 right-0 flex items-center gap-1 rounded border border-line bg-panel px-1.5 py-0.5 text-[10.5px] text-ink-dim opacity-0 transition hover:text-arc focus:opacity-100 group-hover/table:opacity-100"
        title="Copy this table as CSV, for a spreadsheet"
        data-copy-csv
      >
        {copied ? <Check size={11} className="text-arc" /> : <Table2 size={11} />}
        {copied ? "Copied" : "Copy CSV"}
      </button>
    </div>
  );
}

function MarkdownBody({ content, onOpenInCanvas }: Props) {
  // Code blocks are numbered in document order so "open in canvas" can point
  // at the right artifact — the same order lib/codeblocks.ts produces.
  let blockIndex = -1;

  return (
    <div className="prose-jarvis text-[15px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          img({ src, alt }) {
            return <ChatImage src={typeof src === "string" ? src : undefined} alt={alt} />;
          },
          pre({ children }) {
            blockIndex += 1;
            return (
              <CodeBlock index={blockIndex} onOpenInCanvas={onOpenInCanvas}>
                {children}
              </CodeBlock>
            );
          },
          table({ children }) {
            return <TableBlock>{children}</TableBlock>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownBody);
