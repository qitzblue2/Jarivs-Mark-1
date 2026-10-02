"use client";

import { Plus, Trash2 } from "lucide-react";
import { MAX_PROMPTS, MAX_PROMPT_NAME, MAX_PROMPT_TEXT, normalizePromptName, type SavedPrompt } from "@/lib/prompts";

interface Props {
  prompts: SavedPrompt[];
  onChange: (prompts: SavedPrompt[]) => void;
}

/**
 * Saved prompts, in Settings. Each is a name and some text; typing `/name` in
 * the composer puts the text there to edit and send.
 *
 * Names are cleaned as you leave the field rather than on every keystroke —
 * rewriting what someone is typing under their cursor is how a form becomes
 * infuriating — and a name that is empty, taken or reserved is flagged where it
 * is instead of silently dropped.
 */
export default function PromptsEditor({ prompts, onChange }: Props) {
  const set = (i: number, patch: Partial<SavedPrompt>) =>
    onChange(prompts.map((p, at) => (at === i ? { ...p, ...patch } : p)));

  const problem = (p: SavedPrompt, i: number): string | null => {
    const name = normalizePromptName(p.name);
    if (!p.name.trim()) return "Give it a name.";
    if (!name) return "That name is taken by a built-in command.";
    if (prompts.some((q, at) => at !== i && normalizePromptName(q.name) === name)) return "Another prompt has that name.";
    return null;
  };

  return (
    <section data-prompts-editor>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Saved prompts</h3>
        <button
          onClick={() => onChange([...prompts, { name: "", text: "" }])}
          disabled={prompts.length >= MAX_PROMPTS}
          className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-dim transition hover:text-arc disabled:opacity-40"
        >
          <Plus size={11} /> Add
        </button>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
        Text you reuse. Type <code className="font-mono">/name</code> in the message box and it appears there, ready to
        edit and send.
      </p>
      {prompts.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-3 text-center text-[12px] text-ink-faint">
          None yet — try “review”: <em>Review this code for bugs, then for clarity.</em>
        </p>
      ) : (
        <ul className="space-y-2">
          {prompts.map((p, i) => {
            const issue = problem(p, i);
            return (
              <li key={i} className="rounded-lg border border-line-soft p-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-ink-faint">/</span>
                  <input
                    value={p.name}
                    maxLength={MAX_PROMPT_NAME + 4}
                    onChange={(e) => set(i, { name: e.target.value })}
                    onBlur={() => {
                      const name = normalizePromptName(p.name);
                      if (name && name !== p.name) set(i, { name });
                    }}
                    placeholder="name"
                    aria-label="Prompt name"
                    className="min-w-0 flex-1 rounded border border-line bg-base px-2 py-1 font-mono text-[12px] outline-none focus:border-arc-dim"
                  />
                  <button
                    onClick={() => onChange(prompts.filter((_, at) => at !== i))}
                    className="rounded p-1 text-ink-faint transition hover:bg-line hover:text-danger"
                    title="Delete this prompt"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <textarea
                  value={p.text}
                  maxLength={MAX_PROMPT_TEXT}
                  onChange={(e) => set(i, { text: e.target.value })}
                  rows={3}
                  placeholder="The text to put in the message box"
                  aria-label="Prompt text"
                  className="mt-1.5 w-full resize-y rounded border border-line bg-base px-2 py-1.5 text-[12px] leading-relaxed outline-none focus:border-arc-dim"
                />
                {issue && <p className="mt-1 text-[11px] text-warn">{issue}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
