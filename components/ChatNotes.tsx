"use client";

import { useState } from "react";
import { NotebookPen, X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";

interface Props {
  open: boolean;
  chatTitle: string;
  notes: string;
  onSave: (notes: string) => void;
  onClose: () => void;
}

const MAX = 20_000;

/**
 * Notes about a chat, for you. They are saved with the chat, shown in no export,
 * and never sent to a model — a place for "what I decided", "still to check" or
 * the link you will need tomorrow, without it becoming part of the conversation.
 */
export default function ChatNotes({ open, chatTitle, notes, onSave, onClose }: Props) {
  return open ? <Form chatTitle={chatTitle} notes={notes} onSave={onSave} onClose={onClose} /> : null;
}

function Form({ chatTitle, notes, onSave, onClose }: Omit<Props, "open">) {
  const ref = useDialogFocus(true);
  useEscape(true, onClose);
  const [text, setText] = useState(notes);

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="notes-title" data-chat-notes className="w-full max-w-lg rounded-xl border border-line bg-panel shadow-2xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(text);
          }}
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 id="notes-title" className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <NotebookPen size={15} className="shrink-0 text-arc" aria-hidden />
              <span className="truncate">Notes — {chatTitle}</span>
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink">
              <X size={16} />
            </button>
          </header>
          <div className="px-4 py-4">
            <label className="block">
              <span className="sr-only">Notes about this chat</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                maxLength={MAX}
                placeholder="What you decided, what is left to check…"
                data-notes-text
                className="w-full resize-y rounded-md border border-line bg-base px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-arc-dim"
              />
            </label>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">Private: never sent to a model and left out of exports. They are kept with the chat and in backups.</p>
          </div>
          <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
            <span className="text-[11px] text-ink-faint" data-notes-count>
              {text.length.toLocaleString("en-US")} / {MAX.toLocaleString("en-US")}
            </span>
            <span className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition hover:text-ink">
                Cancel
              </button>
              <button type="submit" data-notes-save className="rounded-md bg-arc-solid px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-arc-solid-hover">
                Save notes
              </button>
            </span>
          </footer>
        </form>
      </div>
    </div>
  );
}
