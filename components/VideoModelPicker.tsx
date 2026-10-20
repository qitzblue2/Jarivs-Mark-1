"use client";

import { useMemo, useState } from "react";
import type { VideoModel } from "@/lib/videos/models";
import { splitFreePaid } from "@/lib/videos/catalog";

interface Props {
  models: VideoModel[];
  value: string;
  onChange: (id: string) => void;
  /** Ids you have marked as covered by your subscription. */
  marked: string[];
  onToggleMarked: (id: string) => void;
  source: "live" | "builtin" | null;
  subscriptionListing: boolean;
}

const SOUND: Record<VideoModel["sound"], string> = { yes: "Sound", unknown: "Sound?", no: "Silent" };

/**
 * Every video model on offer, in two sections: those that cost nothing beyond
 * your subscription, and those billed per video. Which is which comes from
 * NanoGPT's list where it says, and from you where it doesn't.
 */
export default function VideoModelPicker({ models, value, onChange, marked, onToggleMarked, source, subscriptionListing }: Props) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? models.filter((m) => words.every((w) => `${m.label} ${m.id}`.toLowerCase().includes(w))) : models;
  }, [models, query]);
  const { free, paid } = splitFreePaid(shown);
  const current = models.find((m) => m.id === value);
  const isMarked = Boolean(current && marked.includes(current.id));
  const listedFree = Boolean(current?.free && !isMarked);

  const section = (title: string, hint: string, list: VideoModel[], id: string, empty: string) => (
    <section aria-labelledby={id} data-model-section={id} className="space-y-1">
      <h3 id={id} className="text-[11.5px] font-semibold text-ink-dim">
        {title} <span className="font-normal text-ink-faint">({list.length})</span>
      </h3>
      <p className="text-[11px] text-ink-faint">{hint}</p>
      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-2.5 py-2 text-[11.5px] text-ink-faint" data-model-empty={id}>
          {empty}
        </p>
      ) : (
        <div role="radiogroup" aria-labelledby={id} className="grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2" tabIndex={-1}>
          {list.map((m) => {
            const on = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-model={m.id}
                onClick={() => onChange(m.id)}
                className={`flex min-h-10 flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition ${on ? "border-arc-dim bg-arc-dim/15 text-ink" : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"}`}
              >
                <span className="w-full truncate text-[12.5px]">{m.label}</span>
                <span className="text-[11px] text-ink-dim">
                  {SOUND[m.sound]}
                  {m.price ? ` · ${m.price}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-2.5" data-video-models>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-ink-dim">Model</span>
        {models.length > 8 && (
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models…" aria-label="Search video models" data-video-model-search className="min-w-0 flex-1 rounded-md border border-line bg-base px-2.5 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim" />
        )}
        <span className="ml-auto text-[11px] text-ink-faint" data-video-model-source>
          {source === "live" ? "NanoGPT's current list" : "Built-in list — NanoGPT's own couldn't be reached"}
        </span>
      </div>

      {section(
        "Free — included in your subscription",
        subscriptionListing ? "Models NanoGPT lists as part of your subscription, and any you marked." : "Models the list marks as costing nothing extra, and any you marked.",
        free,
        "video-free",
        "None found. NanoGPT's list doesn't say which video models a subscription covers, so if you know one is covered, select it and tick “Included in my subscription”.",
      )}
      {section("Paid — billed per video", "Charged to your NanoGPT balance each time. The price shows where NanoGPT gives one.", paid, "video-paid", "Nothing here.")}

      {current && (
        <div className="space-y-1.5 rounded-md border border-line-soft bg-base px-3 py-2" data-video-model-detail>
          {current.description && <p className="text-[11.5px] leading-relaxed text-ink-faint">{current.description}</p>}
          <p className="text-[11.5px] text-ink-faint" data-video-sound-note>
            {current.sound === "yes" ? "Makes its own sound: speech, effects and ambience." : current.sound === "unknown" ? "NanoGPT doesn't say whether this model makes sound, so it may come back silent." : "This model makes silent video; the speech and sound boxes are ignored."}
          </p>
          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-ink">
            <input type="checkbox" checked={isMarked || listedFree} disabled={listedFree} onChange={() => onToggleMarked(current.id)} data-video-mark-included className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]" />
            <span>
              Included in my subscription
              <span className="block text-[11px] text-ink-faint">{listedFree ? "NanoGPT's list says so." : "Only moves it to the Free section here; it changes nothing NanoGPT charges."}</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
