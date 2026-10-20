"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { findLabel, findSpans, stepMatch } from "@/lib/reading";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The scrolling conversation, whose messages are searched. */
  scope: React.RefObject<HTMLElement | null>;
  /** Changes whenever the conversation does, so matches are found again. */
  revision: string;
}

/** The browser's text highlighting, where it has it: marking words without touching what React rendered. */
interface Highlights {
  set(name: string, value: unknown): void;
  delete(name: string): void;
}
const highlightApi = (): { highlights: Highlights; Highlight: new (...ranges: Range[]) => unknown } | null => {
  const css = typeof CSS !== "undefined" ? (CSS as unknown as { highlights?: Highlights }) : null;
  const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return css?.highlights && Highlight ? { highlights: css.highlights, Highlight } : null;
};

/** The text of the conversation worth searching: what you and JARVIS said, not the buttons under it. */
function textNodes(scope: HTMLElement): Text[] {
  const nodes: Text[] = [];
  for (const message of scope.querySelectorAll("[data-msg]")) {
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement?.closest("[data-no-find], .sr-only, script, style, button") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data) nodes.push(n as Text);
  }
  return nodes;
}

/**
 * Find in this chat: type, and every match is marked, with "3 of 12" and
 * Enter / Shift+Enter to move between them. Reads the page as rendered, so what
 * you can find is what you can see — code, tables and all.
 */
export default function FindBar({ open, onClose, scope, revision }: Props) {
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  // The ranges themselves are state, not just their count: a longer query can match
  // the same number of places, and the marks must follow the words, not the total.
  const [found, setFound] = useState<Range[]>([]);
  const total = found.length;
  const input = useRef<HTMLInputElement>(null);

  // Opening puts the cursor in the box, with the last search selected for retyping.
  useEffect(() => {
    if (open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [open]);

  // Find them again whenever the words or the conversation change.
  useEffect(() => {
    if (!open || !scope.current) {
      setFound([]);
      return;
    }
    const nodes = textNodes(scope.current);
    const spans = findSpans(nodes.map((n) => n.data), query);
    setFound(
      spans.map((s) => {
        const r = document.createRange();
        r.setStart(nodes[s.node], s.start);
        r.setEnd(nodes[s.node], s.end);
        return r;
      }),
    );
    setCurrent(0);
  }, [open, query, revision, scope]);

  // Mark them, and bring the current one into view.
  useEffect(() => {
    const api = highlightApi();
    if (!open || found.length === 0) {
      api?.highlights.delete("find-match");
      api?.highlights.delete("find-current");
      return;
    }
    const here = found[Math.min(current, found.length - 1)];
    if (api) {
      api.highlights.set("find-match", new api.Highlight(...found));
      api.highlights.set("find-current", new api.Highlight(here));
    }
    here.startContainer.parentElement?.scrollIntoView({ block: "center" });
  }, [open, current, found]);

  useEffect(
    () => () => {
      const api = highlightApi();
      api?.highlights.delete("find-match");
      api?.highlights.delete("find-current");
    },
    [],
  );

  if (!open) return null;

  const go = (dir: 1 | -1) => setCurrent((c) => stepMatch(c, total, dir));
  const label = findLabel(query, current, total);

  return (
    <div className="flex items-center gap-2 border-b border-line-soft bg-panel px-3 py-1.5" role="search" aria-label="Find in this chat" data-find-bar>
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder="Find in this chat"
        aria-label="Find in this chat"
        data-find-input
        className="min-w-0 flex-1 rounded-md border border-line bg-base px-2.5 py-1 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim"
      />
      <span role="status" aria-live="polite" className="w-20 shrink-0 text-right text-[12px] text-ink-dim" data-find-count>
        {label}
      </span>
      <button type="button" onClick={() => go(-1)} disabled={total === 0} aria-label="Previous match" title="Previous (Shift+Enter)" className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink disabled:opacity-40">
        <ChevronUp size={15} aria-hidden />
      </button>
      <button type="button" onClick={() => go(1)} disabled={total === 0} aria-label="Next match" title="Next (Enter)" data-find-next className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink disabled:opacity-40">
        <ChevronDown size={15} aria-hidden />
      </button>
      <button type="button" onClick={onClose} aria-label="Close find" title="Close (Esc)" className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink">
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}
