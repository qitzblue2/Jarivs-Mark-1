"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";
import { fillVariables, promptVariables } from "@/lib/composing";

interface Props {
  /** The saved prompt being used, or null when nothing is. */
  prompt: { name: string; text: string } | null;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

/**
 * A saved prompt with blanks — "Translate this into {{language}}" — asks for
 * them before it fills the message box, so the words arrive finished and you
 * still read them before sending. Leaving one empty leaves it as written.
 */
export default function PromptVariables({ prompt, onSubmit, onClose }: Props) {
  // The form exists only while it is open, so each use starts with empty blanks.
  return prompt ? <Form prompt={prompt} onSubmit={onSubmit} onClose={onClose} /> : null;
}

function Form({ prompt, onSubmit, onClose }: { prompt: { name: string; text: string }; onSubmit: (text: string) => void; onClose: () => void }) {
  const ref = useDialogFocus(true);
  useEscape(true, onClose);
  const [values, setValues] = useState<Record<string, string>>({});
  const names = promptVariables(prompt.text);

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="prompt-vars-title" data-prompt-variables className="w-full max-w-md rounded-xl border border-line bg-panel shadow-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(fillVariables(prompt.text, values));
        }}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="prompt-vars-title" className="text-sm font-semibold">
            Fill in <span className="font-mono text-arc">/{prompt.name}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink">
            <X size={16} />
          </button>
        </header>
        <div className="space-y-3 px-4 py-4">
          {names.map((name) => (
            <label key={name} className="block">
              <span className="mb-1 block text-[12px] font-medium capitalize text-ink-dim">{name}</span>
              <input
                value={values[name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                data-prompt-variable={name}
                className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 text-[13px] text-ink outline-none transition focus:border-arc-dim"
              />
            </label>
          ))}
          <p className="text-[11.5px] leading-relaxed text-ink-faint">It goes in the message box for you to read; nothing is sent.</p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition hover:text-ink">
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-arc-solid px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-arc-solid-hover" data-prompt-variables-submit>
            Fill the message box
          </button>
        </footer>
      </form>
      </div>
    </div>
  );
}
