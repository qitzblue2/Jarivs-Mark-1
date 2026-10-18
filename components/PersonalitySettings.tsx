"use client";

import { useState } from "react";
import { Dices, Save, Trash2 } from "lucide-react";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { matchPreset, presetText, randomPersona } from "@/lib/personas";
import {
  DIAL_INFO,
  DIAL_MOODS,
  DIALS,
  MAX_CUSTOM_PERSONAS,
  NEUTRAL_DIALS,
  cleanCustomPersonas,
  cleanDials,
  dialsHint,
  moodOf,
  type CustomPersona,
  type Dials,
} from "@/lib/persona-dials";

interface Props {
  persona: string;
  onPersona: (text: string) => void;
  dials: Dials | undefined;
  onDials: (dials: Dials) => void;
  saved: CustomPersona[];
  onSaved: (list: CustomPersona[]) => void;
}

/**
 * Who JARVIS is and how it sounds: pick a ready-made personality, tune four
 * dials, keep ones you wrote. The dials add a sentence or two to the
 * instructions for each reply; their words are held by the server, so a dial
 * left in the middle adds nothing at all.
 */
export default function PersonalitySettings({ persona, onPersona, dials, onDials, saved, onSaved }: Props) {
  const d = cleanDials(dials);
  const mood = moodOf(d);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const hint = dialsHint(d);
  const current = matchPreset(persona);

  function save() {
    const list = cleanCustomPersonas([...saved.filter((s) => s.name.toLowerCase() !== name.trim().toLowerCase()), { name, text: persona }]);
    if (!name.trim()) return setNote("Give it a name first.");
    if (list.length === saved.length && !saved.some((s) => s.name.toLowerCase() === name.trim().toLowerCase())) {
      return setNote(`You can keep ${MAX_CUSTOM_PERSONAS}. Delete one to make room.`);
    }
    onSaved(list);
    setNote(`Saved “${name.trim()}”.`);
    setName("");
  }

  return (
    <section className="space-y-3" data-personality-settings>
      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">Personality</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
          Pick how JARVIS comes across from the list under Persona below, or let it surprise you. A personality changes the manner, not the abilities: it still uses its tools, remembers things and fences code the same way.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPersona(presetText(randomPersona(current?.id)))}
          data-persona-random
          className="mb-1.5 flex min-h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink"
        >
          <Dices size={13} aria-hidden />
          Surprise me
        </button>
        <button
          type="button"
          onClick={() => onPersona(DEFAULT_PERSONA)}
          className="mb-1.5 min-h-8 rounded-md border border-line px-2.5 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink"
        >
          Back to JARVIS
        </button>
      </div>

      <div role="radiogroup" aria-label="Overall mood" data-choice="dial-mood" className="space-y-1">
        <span className="block text-[11.5px] text-ink-dim">Overall mood</span>
        <div className="flex flex-wrap gap-1">
          {DIAL_MOODS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mood === m.id}
              data-value={m.id}
              onClick={() => onDials(m.dials)}
              className={`min-h-8 rounded-md border px-2.5 text-[12px] transition ${mood === m.id ? "border-arc-dim bg-arc-dim/15 text-ink" : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {DIALS.map((k) => (
          <div key={k}>
            <div className="flex items-baseline justify-between text-[11.5px]">
              <label htmlFor={`dial-${k}`} className="text-ink-dim">
                {DIAL_INFO[k].label}
              </label>
              <span className="text-ink-faint">{d[k] === 2 ? "Neutral" : d[k] < 2 ? DIAL_INFO[k].low : DIAL_INFO[k].high}</span>
            </div>
            <input
              id={`dial-${k}`}
              data-dial={k}
              type="range"
              min={0}
              max={4}
              step={1}
              value={d[k]}
              onChange={(e) => onDials({ ...d, [k]: Number(e.target.value) })}
              className="w-full accent-[var(--color-arc)]"
              aria-valuetext={d[k] === 2 ? "Neutral" : d[k] < 2 ? DIAL_INFO[k].low : DIAL_INFO[k].high}
            />
            <div className="flex justify-between text-[10.5px] text-ink-faint">
              <span>{DIAL_INFO[k].low}</span>
              <span>{DIAL_INFO[k].high}</span>
            </div>
          </div>
        ))}
        <p className="text-[11.5px] leading-relaxed text-ink-faint" data-dial-preview>
          {hint ? `Added to each reply: “${hint}”` : "All neutral: nothing is added to the instructions."}
        </p>
        {hint && (
          <button type="button" onClick={() => onDials(NEUTRAL_DIALS)} className="text-[11.5px] text-arc underline-offset-2 hover:underline">
            Reset the dials
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-[11.5px] text-ink-dim">Keep what is in the instructions box as one of your own</p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="persona-save-name" className="sr-only">
            Name for this personality
          </label>
          <input
            id="persona-save-name"
            data-persona-save-name
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            placeholder="Name, e.g. Pirate"
            className="min-w-0 flex-1 basis-40 rounded-md border border-line bg-base px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim"
          />
          <button type="button" onClick={save} data-persona-save className="flex min-h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink">
            <Save size={13} aria-hidden />
            Keep
          </button>
        </div>
        {saved.length > 0 && (
          <ul className="space-y-1" data-persona-saved>
            {saved.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-[12px]">
                <button type="button" onClick={() => onPersona(s.text)} className="min-w-0 flex-1 truncate text-left text-ink hover:text-arc" title="Use this personality">
                  {s.name}
                </button>
                <button type="button" onClick={() => onSaved(saved.filter((x) => x.name !== s.name))} aria-label={`Delete ${s.name}`} className="rounded p-1.5 text-ink-faint transition hover:bg-raised hover:text-danger">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {note && (
          <p role="status" className="text-[11.5px] text-ink-dim">
            {note}
          </p>
        )}
      </div>
    </section>
  );
}
