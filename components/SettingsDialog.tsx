"use client";

import { useEffect, useState } from "react";
import { ExternalLink, KeyRound, RotateCcw, X } from "lucide-react";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { DEFAULT_GREETING } from "@/lib/voice/session";
import { ttsEngines, getTts, kokoroEngine, QUALITY_OPTIONS, type KokoroQuality } from "@/lib/voice/tts";
import type { ProviderState } from "./ModelPicker";
import MemoryEditor from "./MemoryEditor";
import DevicePanel from "./DevicePanel";

export interface Settings {
  persona: string;
  temperature: number;
  /** Let the model call tools (calculator, clock, search). */
  useTools: boolean;
  /** Spoken when the wake word fires. */
  greeting: string;
  ttsEngine: string;
  ttsVoice?: string;
  /** Kokoro model build. Bigger downloads sound better. */
  ttsQuality: KokoroQuality;
  /** Speaking rate. Kokoro's own 1.0 is unhurried. */
  ttsSpeed: number;
  /** Wake-word confidence needed to fire. Raise it if it triggers on its own. */
  wakeThreshold: number;
  /** Bring-your-own keys, provider id → key. Stored in this browser only. */
  keys: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  persona: DEFAULT_PERSONA,
  temperature: 0.7,
  useTools: true,
  greeting: DEFAULT_GREETING,
  ttsEngine: "kokoro",
  ttsQuality: "q8",
  ttsSpeed: 1.1,
  wakeThreshold: 0.5,
  keys: {},
};

interface Props {
  open: boolean;
  settings: Settings;
  providers: ProviderState[];
  storageDriver: string;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

export default function SettingsDialog({
  open,
  settings,
  providers,
  storageDriver,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [voices, setVoices] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  // Voice lists are engine-specific and load asynchronously in Chrome.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getTts(draft.ttsEngine)
      .voices()
      .then((list) => {
        if (!cancelled) setVoices(list);
      })
      .catch(() => setVoices([]));
    return () => {
      cancelled = true;
    };
  }, [open, draft.ttsEngine]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function save() {
    onSave(draft);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-line bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-4 py-4">
          <section>
            <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
              <KeyRound size={12} />
              API keys
            </h3>
            <p className="mb-2.5 text-[11.5px] leading-relaxed text-ink-faint">
              Best practice is to put keys in <code className="font-mono">.env.local</code> so they
              stay server-side. Keys pasted here are kept in this browser&apos;s localStorage and
              sent with each request instead — convenient, but visible to anything running in this
              browser.
            </p>

            <div className="space-y-2.5">
              {providers.map((p) => (
                <div key={p.id}>
                  <div className="mb-1 flex items-center gap-2">
                    <label className="text-[12px] font-medium" htmlFor={`key-${p.id}`}>
                      {p.label}
                    </label>
                    {p.keySource === "server" && (
                      <span className="rounded bg-arc-dim/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-arc">
                        set via {p.envKey}
                      </span>
                    )}
                    <a
                      href={p.signupUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-auto flex items-center gap-0.5 text-[10.5px] text-arc hover:underline"
                    >
                      Free key <ExternalLink size={9} />
                    </a>
                  </div>
                  <input
                    id={`key-${p.id}`}
                    type="password"
                    autoComplete="off"
                    value={draft.keys[p.id] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, keys: { ...d.keys, [p.id]: e.target.value } }))
                    }
                    placeholder={p.keySource === "server" ? "Using the server key" : "Paste a key…"}
                    className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none transition focus:border-arc-dim"
                  />
                  <p className="mt-1 text-[10.5px] text-ink-faint">{p.note}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
                Persona
              </h3>
              <button
                onClick={() => setDraft((d) => ({ ...d, persona: DEFAULT_PERSONA }))}
                className="flex items-center gap-1 text-[10.5px] text-ink-faint transition hover:text-ink"
              >
                <RotateCcw size={10} />
                Reset
              </button>
            </div>
            <textarea
              value={draft.persona}
              onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
              rows={8}
              className="w-full resize-y rounded-md border border-line bg-base px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink outline-none transition focus:border-arc-dim"
            />
          </section>

          <section>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={draft.useTools}
                onChange={(e) => setDraft((d) => ({ ...d, useTools: e.target.checked }))}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-arc)]"
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
                  Tool use
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">
                  Let JARVIS run tools mid-answer. Each tool round is another
                  request against your free-tier limit, capped at 5 per message.
                  Not every free model supports tools; when one does not, the
                  answer is retried without them.
                </span>
              </span>
            </label>
          </section>

          <MemoryEditor open={open} />

          <section className="space-y-2.5">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
              Voice
            </h3>

            <div>
              <label className="mb-1 block text-[11.5px] text-ink-dim" htmlFor="greeting">
                Greeting — spoken when it hears &ldquo;Hey JARVIS&rdquo;
              </label>
              <input
                id="greeting"
                value={draft.greeting}
                onChange={(e) => setDraft((d) => ({ ...d, greeting: e.target.value }))}
                className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 text-[12px] text-ink outline-none transition focus:border-arc-dim"
              />
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-[11.5px] text-ink-dim" htmlFor="tts">
                  Speech engine
                </label>
                <select
                  id="tts"
                  value={draft.ttsEngine}
                  onChange={(e) => setDraft((d) => ({ ...d, ttsEngine: e.target.value, ttsVoice: undefined }))}
                  className="w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink outline-none focus:border-arc-dim"
                >
                  {ttsEngines().map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[11.5px] text-ink-dim" htmlFor="voice">
                  Voice
                </label>
                <select
                  id="voice"
                  value={draft.ttsVoice ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, ttsVoice: e.target.value || undefined }))}
                  className="w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink outline-none focus:border-arc-dim"
                >
                  <option value="">Default</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {draft.ttsEngine === "kokoro" && (
              <>
                <div>
                  <label className="mb-1 block text-[11.5px] text-ink-dim" htmlFor="quality">
                    Model quality
                  </label>
                  <select
                    id="quality"
                    value={draft.ttsQuality}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, ttsQuality: e.target.value as KokoroQuality }))
                    }
                    className="w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink outline-none focus:border-arc-dim"
                  >
                    {QUALITY_OPTIONS.map((q) => (
                      <option key={q.id} value={q.id}>{q.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                    Runs on your machine, no account and no key. Changing this
                    downloads the new build once, then it is cached. Bigger is not
                    always faster — if your GPU offloads part of the model to the
                    CPU, the smaller build can win.
                  </p>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[11.5px] text-ink-dim" htmlFor="speed">
                      Speaking rate
                    </label>
                    <span className="font-mono text-[11px] text-arc">{draft.ttsSpeed.toFixed(2)}×</span>
                  </div>
                  <input
                    id="speed"
                    type="range"
                    min={0.7}
                    max={1.6}
                    step={0.05}
                    value={draft.ttsSpeed}
                    onChange={(e) => setDraft((d) => ({ ...d, ttsSpeed: Number(e.target.value) }))}
                    className="w-full accent-[var(--color-arc)]"
                  />
                  <div className="flex justify-between text-[10.5px] text-ink-faint">
                    <span>Slower</span>
                    <span>Faster</span>
                  </div>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                if (draft.ttsEngine === "kokoro") kokoroEngine.setQuality(draft.ttsQuality);
                void getTts(draft.ttsEngine)
                  .speak(draft.greeting || DEFAULT_GREETING, {
                    voice: draft.ttsVoice,
                    rate: draft.ttsSpeed,
                  })
                  .catch(() => {});
              }}
              className="rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-dim transition hover:border-arc-dim/50 hover:text-arc"
            >
              Test voice
            </button>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11.5px] text-ink-dim" htmlFor="threshold">
                  Wake-word sensitivity
                </label>
                <span className="font-mono text-[11px] text-arc">{draft.wakeThreshold.toFixed(2)}</span>
              </div>
              <input
                id="threshold"
                type="range"
                min={0.2}
                max={0.9}
                step={0.05}
                value={draft.wakeThreshold}
                onChange={(e) => setDraft((d) => ({ ...d, wakeThreshold: Number(e.target.value) }))}
                className="w-full accent-[var(--color-arc)]"
              />
              <p className="text-[10.5px] text-ink-faint">
                Lower catches your voice more easily; raise it if JARVIS wakes on its own.
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
              This machine
            </h3>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              Voice can also run on the server instead of in this page — the microphone and
              speaker attached to the machine JARVIS is running on. That is the mode for a Pi in
              a room.
            </p>
            {open && <DevicePanel />}
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
                Temperature
              </h3>
              <span className="font-mono text-[12px] text-arc">{draft.temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={draft.temperature}
              onChange={(e) => setDraft((d) => ({ ...d, temperature: Number(e.target.value) }))}
              className="w-full accent-[var(--color-arc)]"
            />
            <div className="flex justify-between text-[10.5px] text-ink-faint">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </section>

          <section className="rounded-md border border-line-soft bg-base px-3 py-2 text-[11px] text-ink-faint">
            <span className="text-ink-dim">Storage:</span>{" "}
            {storageDriver === "fs" ? (
              <>
                JSON files in <code className="font-mono">./data/chats</code>. Back them up by
                copying the folder.
              </>
            ) : (
              <span className="text-warn">
                In-memory — this host has a read-only filesystem, so chats are lost on restart.
              </span>
            )}
          </section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-md bg-arc-dim px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-arc"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
