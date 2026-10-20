"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import {
  DEFAULT_APPEARANCE,
  DENSITIES,
  TEXT_SIZES,
  THEMES,
  type Density,
  type TextSize,
  type Theme,
} from "@/lib/appearance";
import { setAppearance, useAppearance } from "@/lib/appearance-store";

const THEME_LABEL: Record<Theme, { label: string; icon: typeof Sun }> = {
  system: { label: "System", icon: Monitor },
  dark: { label: "Dark", icon: Moon },
  light: { label: "Light", icon: Sun },
};
const SIZE_LABEL: Record<TextSize, string> = { small: "Small", normal: "Normal", large: "Large", xlarge: "Extra large" };
const DENSITY_LABEL: Record<Density, string> = { comfortable: "Comfortable", compact: "Compact" };

/** One of a few choices, as a row of radio buttons that apply the moment you pick. */
function Choice<T extends string>({
  label,
  value,
  options,
  render,
  onPick,
  name,
}: {
  label: string;
  value: T;
  options: readonly T[];
  render: (option: T) => React.ReactNode;
  onPick: (option: T) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} data-choice={name} className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-[11.5px] text-ink-dim">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const on = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              data-value={option}
              onClick={() => onPick(option)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition ${
                on
                  ? "border-arc-dim bg-arc-dim/15 text-ink"
                  : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"
              }`}
            >
              {render(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Applies at once — there is nothing to save — and is remembered on this
 * device only, which is why it isn't part of the Settings the dialog saves or
 * exports.
 */
export default function AppearanceSettings() {
  const appearance = useAppearance();
  const isDefault =
    appearance.theme === DEFAULT_APPEARANCE.theme &&
    appearance.textSize === DEFAULT_APPEARANCE.textSize &&
    appearance.density === DEFAULT_APPEARANCE.density &&
    appearance.sidebarWidth === DEFAULT_APPEARANCE.sidebarWidth;

  return (
    <section className="space-y-2.5" data-appearance>
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">Appearance</h3>
        {!isDefault && (
          <button
            type="button"
            onClick={() => setAppearance(DEFAULT_APPEARANCE)}
            className="text-[11px] text-ink-faint transition hover:text-ink"
          >
            Reset
          </button>
        )}
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        Remembered on this device only — a phone and a desk monitor can differ.
      </p>

      <Choice
        name="theme"
        label="Theme"
        value={appearance.theme}
        options={THEMES}
        onPick={(theme) => setAppearance({ theme })}
        render={(t) => {
          const { label, icon: Icon } = THEME_LABEL[t];
          return (
            <>
              <Icon size={12} aria-hidden />
              {label}
            </>
          );
        }}
      />
      <Choice
        name="textSize"
        label="Text size"
        value={appearance.textSize}
        options={TEXT_SIZES}
        onPick={(textSize) => setAppearance({ textSize })}
        render={(t) => SIZE_LABEL[t]}
      />
      <Choice
        name="density"
        label="Density"
        value={appearance.density}
        options={DENSITIES}
        onPick={(density) => setAppearance({ density })}
        render={(d) => DENSITY_LABEL[d]}
      />
      <p className="text-[11px] text-ink-faint">
        Text size applies to messages and the message box; use your browser&apos;s zoom to enlarge everything. Drag
        the edge of the chat list to resize it.
      </p>
    </section>
  );
}
