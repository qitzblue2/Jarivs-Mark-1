"use client";

import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, PanelRightOpen } from "lucide-react";

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
          pre({ children }) {
            blockIndex += 1;
            const index = blockIndex;
            const source = nodeText(children);

            return (
              <div className="group my-3 overflow-hidden rounded-lg border border-line bg-[#0d1117]">
                <div className="flex items-center justify-between border-b border-line-soft bg-panel px-2 py-1">
                  <span className="font-mono text-[11px] text-ink-faint">code</span>
                  <div className="flex items-center gap-1">
                    {onOpenInCanvas && (
                      <button
                        onClick={() => onOpenInCanvas(index)}
                        className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-dim transition hover:bg-line hover:text-arc"
                        title="Open in code canvas"
                      >
                        <PanelRightOpen size={12} />
                        Canvas
                      </button>
                    )}
                    <CopyButton text={source} />
                  </div>
                </div>
                {/* Must stay a real <pre>: swapping it for a div drops
                    white-space: pre and collapses every newline. */}
                <pre className="m-0 overflow-x-auto p-3">{children}</pre>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownBody);
