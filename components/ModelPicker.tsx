"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Cpu, Zap } from "lucide-react";

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
  const ref = useRef<HTMLDivElement>(null);

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
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = providers.find((p) => p.id === provider);

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
        <div className="absolute right-0 z-40 mt-1.5 max-h-[70vh] w-[320px] overflow-y-auto rounded-xl border border-line bg-panel p-1.5 shadow-2xl shadow-black/50">
          {providers.map((p) => (
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
                <ul>
                  {p.models.map((id) => {
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
              )}
            </div>
          ))}

          <p className="border-t border-line-soft px-2 pb-1 pt-2 text-[10px] leading-relaxed text-ink-faint">
            Model lists are fetched live from each provider, so deprecations
            never leave you on a dead model.
          </p>
        </div>
      )}
    </div>
  );
}
