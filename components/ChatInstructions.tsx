"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { MAX_PERSONA } from "@/lib/chat-ops";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";
import PersonaPicker from "./PersonaPicker";

interface Props {
  open: boolean;
  title: string;
  /** This chat's own instructions, if it has any. */
  value: string | undefined;
  onSave: (text: string | null) => void;
  onClose: () => void;
}

/**
 * Instructions for one chat, replacing the ones from Settings for it alone —
 * "answer in French", "you're reviewing my essay" — without changing how every
 * other conversation behaves. Empty means: use the Settings instructions.
 */
export default function ChatInstructions({ open, title, value, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(value ?? "");

  useEscape(open, onClose);
  useEffect(() => {
    if (open) setDraft(value ?? "");
  }, [open, value]);

  const dialogRef = useDialogFocus(open);
  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-line bg-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Chat instructions"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal size={16} className="shrink-0 text-arc" />
            <span className="truncate">Instructions for “{title}”</span>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          <PersonaPicker value={draft} onPick={setDraft} customLabel={draft.trim() ? "Custom" : "Use the Settings instructions"} />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_PERSONA))}
            rows={8}
            autoFocus
            placeholder="Leave empty to use the instructions from Settings."
            aria-label="Instructions for this chat"
            className="w-full resize-y rounded-lg border border-line bg-base p-3 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim"
          />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            These replace your Settings instructions for this chat only, and stay with it — including in copies and
            branches. Memory and the tools you have switched on still apply.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-3">
          {value && (
            <button
              onClick={() => {
                onSave(null);
                onClose();
              }}
              className="mr-auto rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim hover:text-danger"
            >
              Use the default
            </button>
          )}
          <button onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim hover:text-ink">
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft.trim() || null);
              onClose();
            }}
            className="rounded-md bg-arc-solid px-3 py-1.5 text-[13px] font-medium text-white hover:bg-arc-solid-hover"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
