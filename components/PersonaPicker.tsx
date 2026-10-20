"use client";

import { useId } from "react";
import { groupedPresets, matchPreset, presetText } from "@/lib/personas";
import type { CustomPersona } from "@/lib/persona-dials";

interface Props {
  /** The text in the box beside it. */
  value: string;
  /** Called with the preset's full text, to put in the box. */
  onPick: (text: string) => void;
  /** What to call the state where the text is no preset (for a chat, empty means "use Settings"). */
  customLabel?: string;
  /** Personas you saved, listed under their own heading. */
  saved?: CustomPersona[];
}

const same = (a: string, b: string) => a.replace(/\r\n/g, "\n").trim() === b.replace(/\r\n/g, "\n").trim();

/**
 * Fills a persona box from a preset. It only fills the box — nothing is saved
 * until you save, and you can edit the result, at which point this reads
 * "Custom" because it no longer is any preset.
 */
export default function PersonaPicker({ value, onPick, customLabel = "Custom", saved = [] }: Props) {
  const id = useId();
  const current = matchPreset(value);
  const mine = current ? undefined : saved.find((s) => same(s.text, value));
  const selected = current ? current.id : mine ? `mine:${mine.name}` : "";

  return (
    <div className="mb-1.5 flex items-center gap-2" data-persona-picker>
      <label htmlFor={id} className="text-[11.5px] text-ink-dim">
        Start from
      </label>
      <select
        id={id}
        value={selected}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith("mine:")) {
            const found = saved.find((s) => s.name === v.slice(5));
            if (found) onPick(found.text);
            return;
          }
          for (const g of groupedPresets()) {
            const preset = g.presets.find((p) => p.id === v);
            if (preset) return onPick(presetText(preset));
          }
        }}
        className="min-w-0 flex-1 rounded-md border border-line bg-base px-2 py-1 text-[12px] text-ink outline-none focus:border-arc-dim"
      >
        {!current && !mine && <option value="">{customLabel}</option>}
        {groupedPresets().map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.blurb}
              </option>
            ))}
          </optgroup>
        ))}
        {saved.length > 0 && (
          <optgroup label="Yours">
            {saved.map((s) => (
              <option key={s.name} value={`mine:${s.name}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
