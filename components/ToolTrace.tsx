"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronRight, Wrench } from "lucide-react";
import type { ToolRound } from "@/lib/types";

interface Props {
  rounds: ToolRound[];
  /** True while the last round is still running. */
  pending?: boolean;
}

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Mid-stream the JSON is legitimately incomplete.
    return raw;
  }
}

export default function ToolTrace({ rounds, pending }: Props) {
  const [open, setOpen] = useState(false);

  if (rounds.length === 0) return null;

  const calls = rounds.flatMap((r) => r.calls);
  const failures = rounds.flatMap((r) => r.results).filter((r) => r.isError).length;
  const totalMs = rounds.flatMap((r) => r.results).reduce((sum, r) => sum + r.ms, 0);
  const names = [...new Set(calls.map((c) => c.name))];
  // The ceiling the turn was given, if it reported one.
  const budget = rounds[rounds.length - 1]?.maxRounds;

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-line bg-base/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-ink-dim transition hover:text-ink"
      >
        <ChevronRight
          size={12}
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Wrench size={11} className={`shrink-0 ${pending ? "animate-pulse text-arc" : "text-ink-faint"}`} />
        <span className="min-w-0 flex-1 truncate">
          {pending ? "Running" : "Used"} {names.join(", ")}
          {/* On a task run the ceiling is what matters, not the count so far:
              "4 rounds" reads as finished, "step 4 of 25" reads as working. */}
          {budget && budget > rounds.length
            ? ` · step ${rounds.length} of ${budget}`
            : rounds.length > 1 && ` · ${rounds.length} rounds`}
        </span>
        {failures > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-warn">
            <AlertTriangle size={10} />
            {failures}
          </span>
        )}
        {!pending && totalMs > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-ink-faint">{totalMs}ms</span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-line-soft px-2.5 py-2">
          {rounds.map((round) => (
            <div key={round.round} className="space-y-1.5">
              {rounds.length > 1 && (
                <div className="text-[10px] uppercase tracking-wide text-ink-faint">
                  Round {round.round}
                </div>
              )}
              {round.calls.map((call) => {
                const result = round.results.find((r) => r.toolCallId === call.id);
                return (
                  <div key={call.id} className="rounded border border-line-soft bg-panel p-2">
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-arc">{call.name}</span>
                      {result &&
                        (result.isError ? (
                          <AlertTriangle size={10} className="text-danger" />
                        ) : (
                          <Check size={10} className="text-arc" />
                        ))}
                      {result && (
                        <span className="ml-auto font-mono text-[10px] text-ink-faint">
                          {result.ms}ms
                        </span>
                      )}
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-ink-dim">
                      {prettyArgs(call.arguments)}
                    </pre>
                    {result && (
                      <pre
                        className={`mt-1.5 overflow-x-auto whitespace-pre-wrap break-words border-t border-line-soft pt-1.5 font-mono text-[10.5px] leading-relaxed ${
                          result.isError ? "text-danger" : "text-ink-dim"
                        }`}
                      >
                        {result.content.slice(0, 1500)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
