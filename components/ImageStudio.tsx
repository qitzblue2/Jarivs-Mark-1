"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Dices, Download, ImageIcon, Loader2, Sparkles, X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";
import { IMAGE_STYLES, MAX_AVOID, MAX_COUNT, MAX_PROMPT, rememberImagePrompt } from "@/lib/images/styles";
import { DEFAULT_STUDIO, loadStudio, saveStudio, SHAPE_LABEL, SHAPE_LIST, type StudioState } from "@/lib/images/studio-store";
import Lightbox from "./Lightbox";

interface Made {
  id: string;
  url: string;
  seed: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** A prompt to start from (from "/image fox" or the Draw chip). */
  initialPrompt?: string;
  /** Make it as soon as the studio opens — only for a prompt you typed and sent as a command. */
  autoRun?: boolean;
  /** Your NanoGPT key from Settings, if you gave one there. */
  nanoKey?: string;
  onOpenGallery?: () => void;
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/**
 * Draw on request: a prompt, a style, a shape, one to four pictures. This goes
 * straight to the picture service rather than through the chat model, so it
 * costs no chat tokens and the pictures land in the gallery like any other.
 * Nothing is made until you press the button (or sent /image yourself).
 */
export default function ImageStudio({ open, onClose, initialPrompt, autoRun, nanoKey, onOpenGallery }: Props) {
  const [state, setState] = useState<StudioState>(DEFAULT_STUDIO);
  const [prompt, setPrompt] = useState("");
  const [avoid, setAvoid] = useState("");
  const [seed, setSeed] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Made[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<{ provider: string; note: string } | null>(null);
  const [viewing, setViewing] = useState<Made | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const headers = useCallback(
    (json = false): HeadersInit => ({
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(nanoKey ? { "x-jarvis-keys": JSON.stringify({ nanogpt: nanoKey }) } : {}),
    }),
    [nanoKey],
  );

  const make = useCallback(
    async (text: string, overrideSeed?: number | null) => {
      const wanted = text.trim();
      if (!wanted || busy) return;
      setBusy(true);
      setError(null);
      abort.current = new AbortController();
      const body: Record<string, unknown> = { prompt: wanted, style: state.style, shape: state.shape, count: state.count };
      if (avoid.trim()) body.avoid = avoid.trim();
      const chosenSeed = overrideSeed ?? (seed.trim() && /^\d+$/.test(seed.trim()) ? Number(seed.trim()) : null);
      if (chosenSeed !== null) body.seed = chosenSeed;
      try {
        const res = await fetch("/api/images/generate", { method: "POST", headers: headers(true), body: JSON.stringify(body), signal: abort.current.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Couldn't make a picture.");
        } else {
          setMade(data.images ?? []);
          if (data.warning) setError(`Made ${data.images.length}, then: ${data.warning}`);
          const next = { ...state, history: rememberImagePrompt(state.history, wanted) };
          setState(next);
          saveStudio(storage(), next);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [avoid, busy, headers, seed, state],
  );

  // Open: restore what was chosen last time, learn which service would draw, take a given prompt.
  const ran = useRef(false);
  useEffect(() => {
    if (!open) {
      ran.current = false;
      return;
    }
    setState(loadStudio(storage()));
    setError(null);
    setMade([]);
    setSeed("");
    if (initialPrompt) setPrompt(initialPrompt);
    void fetch("/api/images/generate", { headers: headers() })
      .then((r) => r.json())
      .then((d) => setProvider({ provider: d.provider, note: d.note }))
      .catch(() => setProvider(null));
  }, [open, initialPrompt, headers]);

  useEffect(() => {
    if (open && autoRun && initialPrompt && !ran.current && provider) {
      ran.current = true;
      void make(initialPrompt);
    }
  }, [open, autoRun, initialPrompt, provider, make]);

  useEscape(open && !viewing, onClose);
  const dialogRef = useDialogFocus(open);
  if (!open) return null;

  const update = (patch: Partial<StudioState>) => {
    const next = { ...state, ...patch };
    setState(next);
    saveStudio(storage(), next);
  };

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — the browser blocked the clipboard.");
    }
  }

  const radio = (on: boolean) =>
    `min-h-8 rounded-md border px-2.5 py-1 text-[12px] transition ${on ? "border-arc-dim bg-arc-dim/15 text-ink" : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"}`;

  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl border border-line bg-panel shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="studio-title" data-image-studio onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <h2 id="studio-title" className="flex items-center gap-2 text-sm font-semibold">
            <ImageIcon size={16} className="text-arc" aria-hidden />
            Image studio
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink">
            <X size={16} />
          </button>
        </header>

        <div className="max-h-[75vh] space-y-3.5 overflow-y-auto p-4" tabIndex={0} role="region" aria-label="Studio controls">
          <div>
            <label htmlFor="studio-prompt" className="mb-1 block text-[12px] text-ink-dim">
              What should it draw?
            </label>
            <textarea
              id="studio-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void make(prompt);
                }
              }}
              rows={3}
              data-studio-prompt
              placeholder="A lighthouse in a storm, wet paper, soft edges"
              className="w-full resize-none rounded-md border border-line bg-base px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim"
            />
            {state.history.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-studio-history>
                <span className="text-[11px] text-ink-faint">Recent:</span>
                {state.history.slice(0, 4).map((h) => (
                  <button key={h} type="button" onClick={() => setPrompt(h)} title={h} className="max-w-[16rem] truncate rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-dim hover:border-arc-dim/50 hover:text-ink">
                    {h}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div role="radiogroup" aria-label="Style" data-choice="style" className="space-y-1">
            <span className="block text-[12px] text-ink-dim">Style</span>
            <div className="flex flex-wrap gap-1.5">
              {IMAGE_STYLES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={state.style === s.id} data-value={s.id} onClick={() => update({ style: s.id })} className={radio(state.style === s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2.5">
            <div role="radiogroup" aria-label="Shape" data-choice="shape" className="space-y-1">
              <span className="block text-[12px] text-ink-dim">Shape</span>
              <div className="flex flex-wrap gap-1.5">
                {SHAPE_LIST.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={state.shape === s} data-value={s} onClick={() => update({ shape: s })} className={radio(state.shape === s)}>
                    {SHAPE_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <div role="radiogroup" aria-label="How many" data-choice="count" className="space-y-1">
              <span className="block text-[12px] text-ink-dim">How many</span>
              <div className="flex gap-1.5">
                {Array.from({ length: MAX_COUNT }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={state.count === n} data-value={n} onClick={() => update({ count: n })} className={radio(state.count === n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-0 flex-1 basis-56">
              <label htmlFor="studio-avoid" className="mb-1 block text-[12px] text-ink-dim">
                Leave out <span className="text-ink-faint">(optional)</span>
              </label>
              <input id="studio-avoid" value={avoid} onChange={(e) => setAvoid(e.target.value.slice(0, MAX_AVOID))} placeholder="text, watermark, blur" className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim" />
            </div>
            <div className="w-40">
              <label htmlFor="studio-seed" className="mb-1 block text-[12px] text-ink-dim">
                Seed <span className="text-ink-faint">(optional)</span>
              </label>
              <input id="studio-seed" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="random" className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void make(prompt)} disabled={busy || !prompt.trim() || provider?.provider === "none"} data-studio-make className="flex min-h-9 items-center gap-1.5 rounded-lg bg-arc-solid px-4 text-[13px] text-white transition hover:bg-arc-solid-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-faint">
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
              {busy ? "Drawing…" : state.count > 1 ? `Make ${state.count} pictures` : "Make a picture"}
            </button>
            {busy && (
              <button type="button" onClick={() => abort.current?.abort()} className="min-h-9 rounded-lg border border-line px-3 text-[12.5px] text-ink-dim hover:text-ink">
                Stop
              </button>
            )}
            <button type="button" onClick={() => void copyPrompt()} disabled={!prompt.trim()} className="flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] text-ink-dim hover:text-ink disabled:opacity-50">
              {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
              Copy prompt
            </button>
            {onOpenGallery && (
              <button type="button" onClick={onOpenGallery} className="min-h-9 rounded-lg border border-line px-3 text-[12.5px] text-ink-dim hover:text-ink">
                Open the gallery
              </button>
            )}
            <span className="ml-auto text-[11.5px] text-ink-faint" data-studio-provider>
              {provider?.note ?? ""}
            </span>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-warn/40 px-3 py-2 text-[12.5px] text-warn" data-studio-error>
              {error}
            </p>
          )}

          {made.length > 0 && (
            <ul className={`grid gap-3 ${made.length === 1 ? "grid-cols-1" : "grid-cols-2"}`} data-studio-results>
              {made.map((m) => (
                <li key={m.id} className="overflow-hidden rounded-lg border border-line bg-base" data-studio-result={m.id}>
                  <button type="button" onClick={() => setViewing(m)} className="block w-full" title="View larger">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={prompt} className="w-full object-cover" />
                  </button>
                  <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[11.5px] text-ink-faint">
                    <span className="font-mono">seed {m.seed}</span>
                    <button type="button" onClick={() => void make(prompt, m.seed + 1)} disabled={busy} className="ml-auto flex min-h-7 items-center gap-1 rounded px-1.5 text-arc hover:underline disabled:opacity-50" title="The same prompt with a different seed">
                      <Dices size={12} aria-hidden />
                      Another seed
                    </button>
                    <a href={`${m.url}?download=1`} className="flex min-h-7 items-center gap-1 rounded px-1.5 text-arc hover:underline" aria-label="Download this picture">
                      <Download size={12} aria-hidden />
                      Save
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {viewing && <Lightbox src={viewing.url} alt={prompt} onClose={() => setViewing(null)} />}
    </div>
  );
}
