"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Cpu, Search, Stethoscope, Zap } from "lucide-react";

export interface ProviderState {
  id: string;
  label: string;
  note: string;
  signupUrl: string;
  envKey: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  hasKey: boolean;
  /** Usable right now — which for a local server means "needs no key". */
  ready: boolean;
  needsKey: boolean;
  /** Where this provider's requests actually go. */
  baseUrl: string;
  /** Can the browser point this slot somewhere else? */
  customEndpoint: boolean;
  /** The operator pinned the URL in the environment; Settings can't move it. */
  endpointLocked: boolean;
  keySource: "server" | "client" | "none" | null;
  models: string[];
  /** The catalogue was too big to send whole; `models` is the first slice. */
  truncated: boolean;
  error: string | null;
}

interface Props {
  providers: ProviderState[];
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
  onOpenSettings: () => void;
}

export default function ModelPicker({
  providers,
  provider,
  model,
  onChange,
  onOpenSettings,
}: Props) {
  const [open, setOpen] = useState(false);
  /**
   * OpenRouter alone serves several hundred models, listed alphabetically.
   * Without a filter, finding a specific one means scrolling past three
   * hundred entries — which reads, reasonably, as the model not being there.
   */
  const [query, setQuery] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Type straight into the filter rather than reaching for the mouse.
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Start each visit unfiltered; a stale query reads as a missing model.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // A result about a model you are no longer on is worse than none.
  useEffect(() => {
    setProbe(null);
  }, [provider, model]);

  /**
   * Ask the selected model to do the one thing JARVIS depends on.
   *
   * Tool calling is what moves the projector, searches the web and stores a
   * memory. A model that accepts the `tools` parameter and then never calls
   * one fails no check anywhere — it just quietly does nothing, which reads
   * as JARVIS being broken rather than the model being unsuitable.
   */
  async function checkModel() {
    setProbing(true);
    setProbe(null);
    try {
      const res = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      const r = await res.json();

      if (!r.ok) {
        setProbe({ ok: false, text: r.error ?? "The probe failed." });
      } else if (r.calledTool) {
        const speed = r.tokensPerSecond ? `, ~${r.tokensPerSecond} tok/s` : "";
        setProbe({
          ok: true,
          text: `Calls tools · first reply in ${(r.firstByteMs / 1000).toFixed(1)}s${speed}`,
        });
      } else {
        setProbe({
          ok: false,
          text:
            `Did not call a tool — it answered "${(r.saidInstead ?? "").slice(0, 60)}…" instead. ` +
            "The projector, search and memory won't work on this model.",
        });
      }
    } catch (err) {
      setProbe({ ok: false, text: (err as Error).message });
    } finally {
      setProbing(false);
    }
  }

  const current = providers.find((p) => p.id === provider);

  const needle = query.trim().toLowerCase();
  const matches = (id: string) => !needle || id.toLowerCase().includes(needle);
  const totalMatching = providers.reduce(
    (n, p) => n + p.models.filter(matches).length,
    0,
  );

  /**
   * A model a provider didn't list is still worth offering.
   *
   * Catalogues go stale, a rate-limited list comes back empty, and a
   * self-hosted server may serve something it doesn't advertise. If what you
   * typed looks like a model id and nothing matched, use it as typed rather
   * than insisting it doesn't exist.
   */
  const typedId = needle && totalMatching === 0 && /^[\w./:-]{3,}$/.test(query.trim())
    ? query.trim()
    : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[60vw] items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[12px] text-ink transition hover:border-arc-dim/50 sm:max-w-none"
      >
        <Zap size={12} className="shrink-0 text-arc" />
        <span className="truncate font-mono">{model || "Select a model"}</span>
        <span className="hidden shrink-0 text-ink-faint sm:inline">· {current?.label ?? provider}</span>
        <ChevronDown size={12} className="shrink-0 text-ink-faint" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1.5 flex max-h-[70vh] w-[320px] flex-col rounded-xl border border-line bg-panel p-1.5 shadow-2xl shadow-black/50">
          <div className="relative mb-1 shrink-0">
            <Search
              size={11}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter models…"
              spellCheck={false}
              className="w-full rounded-md border border-line bg-base py-1.5 pl-7 pr-2 text-[12px] text-ink outline-none transition placeholder:text-ink-faint focus:border-arc-dim"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
          {typedId && (
            <button
              onClick={() => {
                // Attach it to whichever provider is selected, or the first
                // that can actually answer.
                const target = current?.ready ? current : providers.find((x) => x.ready);
                if (target) onChange(target.id, typedId);
                setOpen(false);
              }}
              className="mb-1 block w-full rounded-md border border-dashed border-arc-dim/50 px-2 py-2 text-left text-[11px] text-ink-dim transition hover:text-arc"
            >
              Nothing matched. Use <span className="font-mono text-arc">{typedId}</span> anyway
              <span className="mt-0.5 block text-ink-faint">
                For a model the provider didn&rsquo;t list.
              </span>
            </button>
          )}
          {/* While filtering, a provider with no match is noise — its header
              and its "no key yet" prompt both distract from the one result. */}
          {providers
            .filter((p) => !needle || p.models.some(matches))
            .map((p) => (
            <div key={p.id} className="mb-1 last:mb-0">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <Cpu size={11} className="text-ink-faint" />
                <span className="text-[12px] font-semibold">{p.label}</span>
                {p.keySource === "server" && (
                  <span className="rounded bg-arc-dim/15 px-1 text-[9px] uppercase tracking-wide text-arc">
                    env
                  </span>
                )}
                {p.keySource === "client" && (
                  <span className="rounded bg-line px-1 text-[9px] uppercase tracking-wide text-ink-dim">
                    byo
                  </span>
                )}
                {p.keySource === "none" && (
                  <span className="rounded bg-line px-1 text-[9px] uppercase tracking-wide text-ink-dim">
                    no key
                  </span>
                )}
              </div>

              {/* Asks whether the provider is usable, not whether a key
                  turned up: a local server has no key and needs none, and
                  nagging for one there would be nonsense. */}
              {!p.ready ? (
                <button
                  onClick={() => {
                    setOpen(false);
                    onOpenSettings();
                  }}
                  className="mx-1 mb-1 block w-[calc(100%-0.5rem)] rounded-md border border-dashed border-line px-2 py-2 text-left text-[11px] text-ink-faint transition hover:border-arc-dim/50 hover:text-ink"
                >
                  No key yet — {p.note}
                  <span className="mt-0.5 block text-arc">Add a free key →</span>
                </button>
              ) : p.error ? (
                <div className="mx-1 mb-1 flex items-start gap-1.5 rounded-md bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
                  <AlertCircle size={11} className="mt-0.5 shrink-0" />
                  <span className="break-words">{p.error}</span>
                </div>
              ) : p.models.length === 0 ? (
                <p className="px-2 pb-1.5 text-[11px] text-ink-faint">
                  {p.needsKey
                    ? "No chat models returned."
                    : "Reachable, but serving no models yet."}
                </p>
              ) : (
                <>
                <ul>
                  {p.models.filter(matches).map((id) => {
                    const selected = p.id === provider && id === model;
                    return (
                      <li key={`${p.id}:${id}`}>
                        <button
                          onClick={() => {
                            onChange(p.id, id);
                            setOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11.5px] transition ${
                            selected ? "bg-raised text-arc" : "text-ink-dim hover:bg-raised/60 hover:text-ink"
                          }`}
                        >
                          <Check
                            size={11}
                            className={selected ? "shrink-0 text-arc" : "shrink-0 opacity-0"}
                          />
                          <span className="truncate">{id}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {/* Featherless serves around 22,000 models. Saying so beats
                    letting the filter come back empty and read as absence. */}
                {p.truncated && (
                  <p className="px-2 pb-1.5 pt-0.5 text-[10.5px] leading-relaxed text-ink-faint">
                    First {p.models.length} of a much larger catalogue. For one
                    that isn&rsquo;t here, type its full id above and pick
                    &ldquo;use it anyway&rdquo;.
                  </p>
                )}
                </>
              )}
            </div>
          ))}

          </div>

          {/* The question a model list cannot answer: does this one actually
              do the thing JARVIS needs? */}
          {model && (
            <div className="shrink-0 border-t border-line-soft px-1 pt-1.5">
              <button
                onClick={checkModel}
                disabled={probing}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-ink-dim transition hover:text-arc disabled:opacity-50"
              >
                <Stethoscope size={11} className="shrink-0" />
                {probing ? "Checking…" : "Can this model use tools?"}
              </button>
              {probe && (
                <p
                  className={`px-1.5 pb-1 text-[10.5px] leading-relaxed ${
                    probe.ok ? "text-arc" : "text-warn"
                  }`}
                >
                  {probe.text}
                </p>
              )}
            </div>
          )}

          <p className="shrink-0 border-t border-line-soft px-2 pb-1 pt-2 text-[10px] leading-relaxed text-ink-faint">
            Model lists are fetched live from each provider, so deprecations
            never leave you on a dead model.
          </p>
        </div>
      )}
    </div>
  );
}
