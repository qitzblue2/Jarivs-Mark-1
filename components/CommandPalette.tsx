"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";
import { rankPalette, type PaletteItem } from "@/lib/palette";

export interface RunnableItem extends PaletteItem {
  run: () => void;
}

interface Props {
  open: boolean;
  items: RunnableItem[];
  onClose: () => void;
}

/**
 * Everything JARVIS can do, one box. Type to narrow it, arrows to move, Enter
 * to run, Esc to leave. Actions come first, then your chats, then models.
 */
export default function CommandPalette({ open, items, onClose }: Props) {
  return open ? <Palette items={items} onClose={onClose} /> : null;
}

function Palette({ items, onClose }: { items: RunnableItem[]; onClose: () => void }) {
  const ref = useDialogFocus(true);
  useEscape(true, onClose);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => rankPalette(items, query, 14), [items, query]);
  useEffect(() => setAt(0), [query]);

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-palette-option="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  function run(item: RunnableItem | undefined) {
    if (!item) return;
    onClose();
    // After the palette has unmounted, so what it opens (a dialog, a chat) takes focus cleanly.
    setTimeout(item.run, 0);
  }

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Command palette" data-palette className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="shrink-0 text-ink-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (shown.length) setAt((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(shown[at]);
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown.length ? `palette-option-${at}` : undefined}
            aria-label="Type a command, a chat or a model"
            placeholder="Type a command, a chat or a model…"
            data-palette-input
            className="w-full bg-transparent py-3 text-[14px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-ink-faint" data-palette-empty>
            Nothing matches “{query}”.
          </p>
        ) : (
          <ul ref={list} id="palette-list" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-1.5">
            {shown.map((item, i) => (
              <li
                key={item.id}
                id={`palette-option-${i}`}
                role="option"
                aria-selected={i === at}
                data-palette-option={i}
                data-palette-id={item.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(item);
                }}
                onMouseEnter={() => setAt(i)}
                className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[13px] ${i === at ? "bg-raised text-ink" : "text-ink-dim"}`}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">{item.hint ?? item.group}</span>
                {i === at && <CornerDownLeft size={12} className="shrink-0 text-ink-faint" aria-hidden />}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-ink-faint">
          <span>↑↓ to move · Enter to run · Esc to close</span>
          <span aria-live="polite">{shown.length === 0 ? "" : `${shown.length} result${shown.length === 1 ? "" : "s"}`}</span>
        </div>
      </div>
    </div>
  );
}
