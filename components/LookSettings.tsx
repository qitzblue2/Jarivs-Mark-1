"use client";

import { ACCENTS, COLLAPSE_CHOICES, FONTS, WIDTHS, type Accent, type Collapse, type Font, type Width } from "@/lib/prefs";
import { ACCENT_COLORS, ACCENT_LABEL } from "@/lib/accents";
import { setPrefs, usePrefs } from "@/lib/prefs-store";

const FONT_LABEL: Record<Font, string> = { sans: "Sans-serif", serif: "Serif", mono: "Monospace", readable: "Easy to read" };
const WIDTH_LABEL: Record<Width, string> = { narrow: "Narrow", normal: "Normal", wide: "Wide" };
const COLLAPSE_LABEL = (n: Collapse) => (n === 0 ? "Never" : `Over ${n} lines`);

function Choice<T extends string | number>({ label, name, value, options, render, onPick }: { label: string; name: string; value: T; options: readonly T[]; render: (o: T) => React.ReactNode; onPick: (o: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} data-choice={name} className="space-y-1">
      <span className="block text-[11.5px] text-ink-dim">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = o === value;
          return (
            <button
              key={String(o)}
              type="button"
              role="radio"
              aria-checked={on}
              data-value={String(o)}
              onClick={() => onPick(o)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition ${on ? "border-arc-dim bg-arc-dim/15 text-ink" : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"}`}
            >
              {render(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * How messages look and what hides: the typeface, the highlight colour, how wide
 * the column is, blurring while others can see your screen, whether the buttons
 * under a message always show, and folding long code. All apply at once and stay
 * on this device.
 */
export default function LookSettings() {
  const prefs = usePrefs();
  return (
    <section className="space-y-3" data-look-settings>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">Messages and colour</h3>

      <Choice label="Typeface for messages" name="font" value={prefs.font} options={FONTS} onPick={(font) => setPrefs({ font })} render={(f) => FONT_LABEL[f]} />

      <Choice
        label="Highlight colour"
        name="accent"
        value={prefs.accent}
        options={ACCENTS}
        onPick={(accent) => setPrefs({ accent })}
        render={(a: Accent) => (
          <>
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: ACCENT_COLORS[a].solid }} />
            {ACCENT_LABEL[a]}
          </>
        )}
      />

      <Choice label="Width of the conversation" name="width" value={prefs.width} options={WIDTHS} onPick={(width) => setPrefs({ width })} render={(w) => WIDTH_LABEL[w]} />

      <Choice label="Fold long code blocks" name="collapseCode" value={prefs.collapseCode} options={COLLAPSE_CHOICES} onPick={(collapseCode) => setPrefs({ collapseCode })} render={(n) => COLLAPSE_LABEL(n)} />

      <label className="flex cursor-pointer items-start gap-2.5 py-0.5">
        <input type="checkbox" checked={prefs.alwaysActions} onChange={(e) => setPrefs({ alwaysActions: e.target.checked })} data-pref="alwaysActions" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]" />
        <span className="text-[12.5px] text-ink">
          Always show the buttons under messages
          <span className="block text-[11.5px] text-ink-faint">Instead of only when you point at one — easier on a touch screen and for finding them.</span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 py-0.5">
        <input type="checkbox" checked={prefs.privacyBlur} onChange={(e) => setPrefs({ privacyBlur: e.target.checked })} data-pref="privacyBlur" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]" />
        <span className="text-[12.5px] text-ink">
          Blur messages until I point at them
          <span className="block text-[11.5px] text-ink-faint">For working where others can see your screen. Hovering over a message — or tapping or tabbing to it — lifts the blur on that one. It is also in the command palette.</span>
        </span>
      </label>
    </section>
  );
}
