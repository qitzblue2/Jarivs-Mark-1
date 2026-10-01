"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";

interface DayUsage {
  requests: number;
  ok: number;
  rateLimited: number;
  failed: number;
  tokensSent: number;
  lastAt: number;
  lastError?: string;
  lastOk?: boolean;
}

interface Usage {
  days: { day: string; providers: Record<string, DayUsage> }[];
  labels: Record<string, string>;
  cooling: Record<string, number>;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function minutes(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  return m <= 1 ? "under a minute" : `${m} min`;
}

/**
 * What has been spent today, and what is sitting out a rate limit.
 *
 * The counts are JARVIS' own — every request this server sent — rather than
 * the provider's, which is said on the page so a mismatch with a provider's
 * dashboard (other apps on the same key, requests from before the count
 * began) isn't mistaken for a bug.
 */
export default function UsagePanel({ open, onClose }: Props) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setUsage(data);
        setError(null);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    // Cooldowns count down; a stale "3 min" is worse than none.
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [open, refresh]);

  useEscape(open, onClose);

  if (!open) return null;

  const today = new Date().toISOString().slice(0, 10);
  const todays = usage?.days.find((d) => d.day === today)?.providers ?? {};
  const rows = Object.entries(todays).sort(([, a], [, b]) => b.requests - a.requests);
  const label = (id: string) => usage?.labels[id] ?? id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Usage"
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gauge size={16} className="text-arc" />
            Usage
            <span className="text-[11px] font-normal text-ink-faint">today, UTC — when free tiers reset</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => void refresh()} className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink" title="Refresh">
              <RefreshCw size={14} />
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink" title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {error && <p className="mb-3 text-[12px] text-warn">{error}</p>}

          {rows.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-faint">
              {usage ? "Nothing sent to any provider yet today." : "Loading…"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-ink-faint">
                  <tr>
                    <th className="pb-2 font-medium">Provider</th>
                    <th className="pb-2 text-right font-medium">Requests</th>
                    <th className="pb-2 text-right font-medium">Tokens sent</th>
                    <th className="pb-2 text-right font-medium">Refused</th>
                    <th className="pb-2 pl-3 font-medium">Now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {rows.map(([id, u]) => {
                    const cooling = usage?.cooling[id];
                    return (
                      <tr key={id} className="align-top">
                        <td className="py-2 pr-3 text-ink">{label(id)}</td>
                        <td className="py-2 text-right font-mono tabular-nums">{u.requests}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-ink-dim">
                          {id.includes(":") ? "—" : `~${compact(u.tokensSent)}`}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          <span className={u.rateLimited ? "text-warn" : "text-ink-faint"}>{u.rateLimited}</span>
                          {u.failed > 0 && <span className="text-danger" title="Other failures"> +{u.failed}</span>}
                        </td>
                        <td className="py-2 pl-3 text-ink-dim">
                          {cooling ? (
                            <span className="text-warn">Rate-limited — skipped for {minutes(cooling)}</span>
                          ) : u.lastOk === false && u.lastError ? (
                            <span className="line-clamp-2 text-danger" title={u.lastError}>{u.lastError}</span>
                          ) : (
                            <span className="text-arc">Ready</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {usage && usage.days.length > 1 && (
            <>
              <h3 className="mb-2 mt-6 text-[10px] uppercase tracking-widest text-ink-faint">Earlier days</h3>
              <ul className="space-y-1 text-[12px]">
                {usage.days
                  .filter((d) => d.day !== today)
                  .map((d) => {
                    const all = Object.entries(d.providers);
                    const total = all.reduce((sum, [, u]) => sum + u.requests, 0);
                    const refused = all.reduce((sum, [, u]) => sum + u.rateLimited, 0);
                    return (
                      <li key={d.day} className="flex justify-between gap-3 text-ink-dim">
                        <span className="font-mono">{d.day}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-faint">
                          {all.map(([id, u]) => `${label(id)} ${u.requests}`).join(" · ")}
                        </span>
                        <span className="font-mono tabular-nums">
                          {total}
                          {refused > 0 && <span className="text-warn"> ({refused} refused)</span>}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </>
          )}

          <p className="mt-6 text-[11px] leading-relaxed text-ink-faint">
            Counted by JARVIS for requests this server sent, so a provider&apos;s own dashboard can show
            more if the key is used elsewhere. Tokens are estimated at four characters each. A
            rate-limited provider is skipped until its wait is over, and the next one answers instead.
          </p>
        </div>
      </div>
    </div>
  );
}
