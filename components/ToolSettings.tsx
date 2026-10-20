"use client";

import { useEffect, useState } from "react";
import { toggleTool } from "@/lib/model-prefs";

interface ToolInfo {
  name: string;
  description: string;
  tokens: number;
  dangerous: boolean;
}

interface Props {
  disabled: string[];
  onChange: (disabled: string[]) => void;
}

/** The first sentence, for a list that must stay one line a tool. */
const brief = (text: string) => (/^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text).slice(0, 140);

/**
 * Which tools the model may use, one switch each. A tool that is off is not
 * offered to the model and cannot run if it asks anyway; its description also
 * stops costing tokens on every request, which is the other reason to turn off
 * one you never use. The list is what this server would offer right now, so a
 * tool that doesn't exist here (no display, no picture key) isn't listed.
 */
export default function ToolSettings({ disabled, onChange }: Props) {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/tools")
      .then((r) => r.json())
      .then((d) => live && (d.tools ? setTools(d.tools) : setError(d.error ?? "Couldn't load the tools.")))
      .catch(() => live && setError("Couldn't reach the server."));
    return () => {
      live = false;
    };
  }, []);

  const saved = (tools ?? []).filter((t) => disabled.includes(t.name)).reduce((n, t) => n + t.tokens, 0);

  return (
    <section className="space-y-2" data-tool-settings>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">Individual tools</h3>
      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        Turn off the ones you never want used. An off tool isn&apos;t offered to the model and can&apos;t run, and stops costing tokens on every request.
        {" "}
        <span data-tool-saved>{saved > 0 ? `Off now: about ${saved.toLocaleString("en-US")} tokens saved per request.` : ""}</span>
      </p>
      {error && <p className="text-[12px] text-warn">{error}</p>}
      {!tools && !error && <p className="text-[12px] text-ink-faint">Loading…</p>}
      {tools && (
        <ul className="space-y-0.5" aria-label="Tools">
          {tools.map((t) => {
            const on = !disabled.includes(t.name);
            return (
              <li key={t.name}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 transition hover:bg-raised/50">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onChange(toggleTool(disabled, t.name))}
                    data-tool-switch={t.name}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2 text-[12.5px] text-ink">
                      <code className="font-mono text-[12px]">{t.name}</code>
                      {t.dangerous && <span className="rounded bg-warn/15 px-1 text-[9px] uppercase tracking-wide text-warn">reaches out</span>}
                      <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-faint">{t.tokens} tok</span>
                    </span>
                    <span className="block text-[11.5px] leading-relaxed text-ink-faint">{brief(t.description)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
