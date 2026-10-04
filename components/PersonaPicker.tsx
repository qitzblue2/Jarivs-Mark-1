"use client";

import { useId } from "react";
import { matchPreset, PERSONA_PRESETS, presetText } from "@/lib/personas";

interface Props {
  /** The text in the box beside it. */
  value: string;
  /** Called with the preset's full text, to put in the box. */
  onPick: (text: string) => void;
  /** What to call the state where the text is no preset (for a chat, empty means "use Settings"). */
  customLabel?: string;
}

/**
 * Fills a persona box from a preset. It only fills the box — nothing is saved
 * until you save, and you can edit the result, at which point this reads
 * "Custom" because it no longer is any preset.
 */
export default function PersonaPicker({ value, onPick, customLabel = "Custom" }: Props) {
  const id = useId();
  const current = matchPreset(value);

  return (
    <div className="mb-1.5 flex items-center gap-2" data-persona-picker>
      <label htmlFor={id} className="text-[11.5px] text-ink-dim">
        Start from
      </label>
      <select
        id={id}
        value={current?.id ?? ""}
        onChange={(e) => {
          const preset = PERSONA_PRESETS.find((p) => p.id === e.target.value);
          if (preset) onPick(presetText(preset));
        }}
        className="min-w-0 flex-1 rounded-md border border-line bg-base px-2 py-1 text-[12px] text-ink outline-none focus:border-arc-dim"
      >
        {!current && <option value="">{customLabel}</option>}
        {PERSONA_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.blurb}
          </option>
        ))}
      </select>
    </div>
  );
}
