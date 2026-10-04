"use client";

import { useState } from "react";
import { Clipboard, RotateCcw } from "lucide-react";
import type { ProviderState } from "./ModelPicker";
import type { Settings } from "./SettingsDialog";
import { formatDiagnostics, type ClientFacts, type ServerFacts } from "@/lib/diagnostics";
import { keysToReset, listKeys } from "@/lib/reset-browser";
import { useAppearance } from "@/lib/appearance-store";
import { usePrefs } from "@/lib/prefs-store";
import { useInitiative } from "@/lib/initiative/store";

interface Props {
  settings: Settings;
  providers: ProviderState[];
}

/**
 * Two practical things: a summary of this install to copy into a bug report
 * (nothing secret in it — see lib/diagnostics.ts), and a way to put this
 * browser's preferences back as they were, without touching your keys unless you
 * say so.
 */
export default function AboutSettings({ settings, providers }: Props) {
  const appearance = useAppearance();
  const prefs = usePrefs();
  const initiative = useInitiative();
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [alsoSettings, setAlsoSettings] = useState(false);

  async function build(): Promise<string | null> {
    try {
      const res = await fetch("/api/diagnostics", { cache: "no-store" });
      const server = (await res.json()) as ServerFacts & { error?: string };
      if (!res.ok) {
        setNote(server.error ?? "Couldn't read the server's side.");
        return null;
      }
      const client: ClientFacts = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        viewport: `${window.innerWidth}×${window.innerHeight}`,
        online: navigator.onLine,
        providers: providers.map((p) => ({ label: p.label, ready: p.ready && !p.error, models: p.models.length })),
        appearance: { theme: appearance.theme, textSize: appearance.textSize, density: appearance.density },
        settings: {
          temperature: settings.temperature,
          toolsOn: settings.useTools,
          toolsOff: settings.disabledTools?.length ?? 0,
          favourites: settings.favorites?.length ?? 0,
          savedPrompts: settings.prompts?.length ?? 0,
          modelNotes: Object.keys(settings.modelNotes ?? {}).length,
          noFallback: Boolean(settings.noFallback),
          replyLength: settings.replyLength ?? "normal",
        },
        initiative: { enabled: initiative.config.enabled, level: initiative.config.level },
        prefs: { sendKey: prefs.sendKey, font: prefs.font, accent: prefs.accent, width: prefs.width },
      };
      return formatDiagnostics(server, client);
    } catch {
      setNote("Couldn't reach the server.");
      return null;
    }
  }

  async function show() {
    setNote(null);
    setText(await build());
  }

  async function copy() {
    setNote(null);
    const body = text ?? (await build());
    if (!body) return;
    setText(body);
    try {
      await navigator.clipboard.writeText(body);
      setNote("Copied. It holds no keys and none of your text.");
    } catch {
      setNote("The browser wouldn't let me copy — select the text below and copy it by hand.");
    }
  }

  function reset() {
    try {
      for (const k of keysToReset(listKeys(window.localStorage), { includeSettings: alsoSettings })) window.localStorage.removeItem(k);
    } catch {
      /* nothing could be cleared */
    }
    // Everything reads its settings at start-up; a reload is the honest way to have it all agree.
    window.location.reload();
  }

  return (
    <section className="space-y-2.5" data-about-settings>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">About this install</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} data-copy-diagnostics className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink">
          <Clipboard size={13} aria-hidden /> Copy diagnostics
        </button>
        <button type="button" onClick={() => void show()} data-show-diagnostics className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink">
          Show them
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-faint">Versions, what is switched on, how big things are — for a bug report. No API keys, no addresses, none of your chats or notes.</p>
      {note && (
        <p role="status" className="text-[12px] text-ink-dim" data-about-note>
          {note}
        </p>
      )}
      {text && (
        <pre tabIndex={0} aria-label="Diagnostics" data-diagnostics className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-base p-2.5 font-mono text-[11px] leading-relaxed text-ink-dim">
          {text}
        </pre>
      )}

      <div className="border-t border-line-soft pt-2.5">
        {confirm ? (
          <div className="space-y-2" data-reset-confirm>
            <p className="text-[12px] text-ink-dim">
              This clears how this browser looks and behaves — theme, colours, order, suggestions, focus timer, unsent drafts and the last model — and reloads the page. Your chats are on the server and aren&apos;t touched.
            </p>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" checked={alsoSettings} onChange={(e) => setAlsoSettings(e.target.checked)} data-reset-settings className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]" />
              <span className="text-[12px] text-ink">
                Also forget my Settings
                <span className="block text-[11.5px] text-warn">API keys pasted here, instructions, saved prompts and favourites would go too. Keys in .env.local are unaffected.</span>
              </span>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={reset} data-reset-go className="rounded-md border border-danger px-3 py-1.5 text-[12px] font-medium text-danger transition hover:bg-danger/10">
                Reset and reload
              </button>
              <button type="button" onClick={() => setConfirm(false)} className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-dim transition hover:text-ink">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} data-reset-start className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-dim transition hover:border-danger/50 hover:text-danger">
            <RotateCcw size={13} aria-hidden /> Reset this browser…
          </button>
        )}
      </div>
    </section>
  );
}
