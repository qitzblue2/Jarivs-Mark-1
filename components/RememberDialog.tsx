"use client";

import { useState } from "react";
import { Brain, X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";

interface Props {
  /** What to offer to remember, or null when the dialog is closed. */
  draft: string | null;
  onSave: (text: string, always: boolean) => void;
  onClose: () => void;
}

/**
 * Save something from a message to memory. The words you had selected — or the
 * start of the message — arrive here to be shortened or reworded before they
 * are kept, because a memory is read into every chat it is relevant to and
 * short ones cost less and say more.
 */
export default function RememberDialog({ draft, onSave, onClose }: Props) {
  return draft !== null ? <Form draft={draft} onSave={onSave} onClose={onClose} /> : null;
}

function Form({ draft, onSave, onClose }: { draft: string; onSave: Props["onSave"]; onClose: () => void }) {
  const ref = useDialogFocus(true);
  useEscape(true, onClose);
  const [text, setText] = useState(draft);
  const [always, setAlways] = useState(false);
  const empty = !text.trim();

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="remember-title" data-remember-dialog className="w-full max-w-md rounded-xl border border-line bg-panel shadow-2xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!empty) onSave(text.trim(), always);
          }}
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 id="remember-title" className="flex items-center gap-2 text-sm font-semibold">
              <Brain size={15} className="text-arc" aria-hidden /> Remember this
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink">
              <X size={16} />
            </button>
          </header>
          <div className="space-y-3 px-4 py-4">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-dim">What JARVIS should remember</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                maxLength={2000}
                data-remember-text
                className="w-full resize-y rounded-md border border-line bg-base px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition focus:border-arc-dim"
              />
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} data-remember-always className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]" />
              <span className="text-[12.5px] text-ink">
                Always keep in mind
                <span className="block text-[11.5px] text-ink-faint">Put it in every chat, not only when it seems relevant.</span>
              </span>
            </label>
          </div>
          <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
            <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition hover:text-ink">
              Cancel
            </button>
            <button type="submit" disabled={empty} data-remember-save className="rounded-md bg-arc-solid px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-arc-solid-hover disabled:opacity-50">
              Remember
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
