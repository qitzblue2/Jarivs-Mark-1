"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ProviderState } from "./ModelPicker";
import { favoriteKey, parseFavorite } from "@/lib/favorites";
import { MAX_MODEL_NOTES, MAX_NOTE_LENGTH, withModelNote } from "@/lib/model-prefs";

interface Props {
  providers: ProviderState[];
  notes: Record<string, string>;
  onNotes: (notes: Record<string, string>) => void;
  noFallback: boolean;
  onNoFallback: (on: boolean) => void;
}

/**
 * Two things about choosing models: what to do when the one you chose fails, and
 * your own one-line reminders about models ("good for code", "slow but careful")
 * which the picker shows under each name.
 */
export default function ModelSettings({ providers, notes, onNotes, noFallback, onNoFallback }: Props) {
  const [pick, setPick] = useState("");
  const [text, setText] = useState("");

  const choices = useMemo(
    () => providers.filter((p) => p.ready).flatMap((p) => p.models.slice(0, 400).map((m) => ({ key: favoriteKey(p.id, m), label: `${m} — ${p.label}` }))),
    [providers],
  );
  const labelOf = (key: string) => {
    const f = parseFavorite(key);
    return f ? `${f.model} — ${providers.find((p) => p.id === f.provider)?.label ?? f.provider}` : key;
  };
  const entries = Object.entries(notes);

  return (
    <section className="space-y-2.5" data-model-settings>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">Choosing models</h3>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" checked={noFallback} onChange={(e) => onNoFallback(e.target.checked)} data-no-fallback className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]" />
        <span className="min-w-0">
          <span className="block text-[12.5px] text-ink">Don&apos;t fall back to another provider</span>
          <span className="block text-[11.5px] leading-relaxed text-ink-faint">
            Normally, if the model you chose is rate-limited or down, another provider answers instead (and the reply says so). Turn this on to be told it failed rather than be answered by something you didn&apos;t pick — for when the model matters more than an answer.
          </span>
        </span>
      </label>

      <div>
        <h4 className="mb-1 text-[11.5px] font-medium text-ink-dim">Notes on models</h4>
        {entries.length > 0 && (
          <ul className="mb-2 space-y-1" aria-label="Your notes on models">
            {entries.map(([key, note]) => (
              <li key={key} data-model-note-row={key} className="flex items-center gap-2">
                <span className="w-2/5 min-w-0 shrink-0 truncate font-mono text-[11px] text-ink-dim" title={labelOf(key)}>
                  {labelOf(key)}
                </span>
                <input
                  value={note}
                  maxLength={MAX_NOTE_LENGTH}
                  onChange={(e) => onNotes({ ...notes, [key]: e.target.value })}
                  onBlur={() => onNotes(withModelNote(notes, key, notes[key] ?? ""))}
                  aria-label={`Note on ${labelOf(key)}`}
                  className="min-w-0 flex-1 rounded-md border border-line bg-base px-2 py-1 text-[12px] text-ink outline-none focus:border-arc-dim"
                />
                <button type="button" onClick={() => onNotes(withModelNote(notes, key, ""))} aria-label={`Remove the note on ${labelOf(key)}`} className="shrink-0 rounded p-1 text-ink-faint transition hover:text-danger">
                  <Trash2 size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {entries.length < MAX_MODEL_NOTES && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pick || !text.trim()) return;
              onNotes(withModelNote(notes, pick, text));
              setText("");
            }}
          >
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Model to write a note on" data-note-model className="min-w-0 max-w-full flex-1 basis-40 rounded-md border border-line bg-base px-2 py-1 text-[12px] text-ink outline-none focus:border-arc-dim">
              <option value="">Choose a model…</option>
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_NOTE_LENGTH} placeholder="good for code" aria-label="The note" data-note-text className="min-w-0 flex-1 basis-40 rounded-md border border-line bg-base px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim" />
            <button type="submit" disabled={!pick || !text.trim()} data-note-add className="rounded-md border border-line px-2.5 py-1 text-[12px] text-ink-dim transition hover:text-ink disabled:opacity-50">
              Add note
            </button>
          </form>
        )}
        <p className="mt-1 text-[11px] text-ink-faint">Shown under the model&apos;s name in the picker. Saved with Settings.</p>
      </div>
    </section>
  );
}
