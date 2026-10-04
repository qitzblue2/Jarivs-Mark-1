"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileCode2, ListTree, Search } from "lucide-react";
import { outlineOf } from "@/lib/reading";
import type { Message } from "@/lib/types";

interface Props {
  chatId: string;
  messages: Message[];
  onFind: () => void;
  /** Scroll to one of your messages. */
  onJump: (messageId: string) => void;
}

/**
 * Things to do with the chat you are reading, behind one button so the title
 * bar doesn't grow another icon for each: find a word, jump to one of your
 * questions, keep a copy as a web page.
 */
export default function ChatTools({ chatId, messages, onFind, onJump }: Props) {
  const [open, setOpen] = useState(false);
  const [outline, setOutline] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const questions = useMemo(() => (open ? outlineOf(messages) : []), [open, messages]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setOutline(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      trigger.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink-dim transition hover:bg-raised hover:text-ink";

  return (
    <div className="relative" ref={root} data-chat-tools>
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setOutline(false);
        }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Chat tools"
        title="Find, jump to a question, download as a web page"
        data-chat-tools-button
        className={`rounded-md p-1.5 transition hover:bg-raised ${open ? "text-arc" : "text-ink-faint hover:text-ink"}`}
      >
        <ListTree size={16} aria-hidden />
      </button>

      {open && (
        <div role="group" aria-label="Chat tools" className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-line bg-panel p-1.5 shadow-xl">
          <button
            type="button"
            className={item}
            data-tool="find"
            onClick={() => {
              setOpen(false);
              onFind();
            }}
          >
            <Search size={13} aria-hidden />
            <span className="flex-1">Find in this chat</span>
            <kbd className="font-mono text-[10px] text-ink-faint">Ctrl+Shift+F</kbd>
          </button>

          <button type="button" className={item} data-tool="outline" aria-expanded={outline} onClick={() => setOutline((v) => !v)}>
            <ChevronRight size={13} aria-hidden className={`transition ${outline ? "rotate-90" : ""}`} />
            <span className="flex-1">Jump to a question</span>
            <span className="text-[11px] text-ink-faint">{messages.filter((m) => m.role === "user").length}</span>
          </button>
          {outline && (
            <ol className="mb-1 max-h-60 space-y-0.5 overflow-y-auto pl-2" data-outline>
              {questions.length === 0 && <li className="px-2.5 py-1.5 text-[12px] text-ink-faint">Nothing asked yet.</li>}
              {questions.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    data-outline-item={q.id}
                    onClick={() => {
                      setOpen(false);
                      setOutline(false);
                      onJump(q.id);
                    }}
                    className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-[12px] text-ink-dim transition hover:bg-raised hover:text-ink"
                  >
                    <span className="w-5 shrink-0 text-right font-mono text-[10px] text-ink-faint">{q.number}</span>
                    <span className="min-w-0 flex-1 truncate">{q.preview}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}

          <a href={`/api/chats/${chatId}/export?format=html`} className={item} data-tool="html" download onClick={() => setOpen(false)}>
            <FileCode2 size={13} aria-hidden />
            <span className="flex-1">Download as a web page</span>
          </a>
        </div>
      )}
    </div>
  );
}
