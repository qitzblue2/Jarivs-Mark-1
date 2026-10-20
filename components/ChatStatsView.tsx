"use client";

import { useEffect, useState } from "react";
import type { ChatStats } from "@/lib/chat-stats";

const number = (n: number) => n.toLocaleString();

function Card({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-line bg-base px-3 py-2" data-stat={label}>
      <p className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="font-mono text-lg tabular-nums text-ink">{value}</p>
      {detail && <p className="text-[11px] text-ink-faint">{detail}</p>}
    </div>
  );
}

/**
 * What your conversations add up to. Loaded when the tab opens and computed from
 * the chats on the server; nothing is stored about you that isn't already in them.
 */
export default function ChatStatsView() {
  const [stats, setStats] = useState<ChatStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // The browser's offset, so "per day" means the days on your clock.
    fetch(`/api/stats?days=30&tz=${new Date().getTimezoneOffset()}`)
      .then((r) => r.json())
      .then((data) => live && (data.error ? setError(data.error) : setStats(data)))
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p className="text-[12px] text-warn">{error}</p>;
  if (!stats) return <p className="py-8 text-center text-[13px] text-ink-faint">Loading…</p>;
  if (stats.messages.total === 0) {
    return <p className="py-8 text-center text-[13px] text-ink-faint">No conversations yet — there is nothing to count.</p>;
  }

  const max = Math.max(1, ...stats.perDay.map((d) => d.messages));
  const total = stats.perDay.reduce((sum, d) => sum + d.messages, 0);
  const since = stats.firstMessageAt ? new Date(stats.firstMessageAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

  return (
    <div className="space-y-5" data-chat-stats>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card
          label="Chats"
          value={number(stats.chats.total)}
          detail={[stats.chats.pinned ? `${stats.chats.pinned} pinned` : "", stats.chats.archived ? `${stats.chats.archived} archived` : ""].filter(Boolean).join(" · ") || undefined}
        />
        <Card label="Messages" value={number(stats.messages.total)} detail={`${number(stats.messages.user)} yours · ${number(stats.messages.assistant)} JARVIS`} />
        <Card label="Words" value={number(stats.words.user + stats.words.assistant)} detail={`${number(stats.words.user)} yours · ${number(stats.words.assistant)} JARVIS`} />
        <Card label="Since" value={since} />
        {stats.reactions.up + stats.reactions.down > 0 && (
          <Card label="Ratings" value={`${number(stats.reactions.up)} 👍 ${number(stats.reactions.down)} 👎`} detail="replies you rated" />
        )}
      </div>

      <section aria-labelledby="stats-days">
        <h3 id="stats-days" className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">
          Messages per day · last {stats.perDay.length} days
        </h3>
        <div
          role="img"
          aria-label={`${total} messages over the last ${stats.perDay.length} days${stats.busiest ? `; the most in one day was ${stats.busiest.messages}, on ${stats.busiest.day}` : ""}`}
          className="flex h-24 items-end gap-[3px]"
          data-day-chart
        >
          {stats.perDay.map((d, i) => (
            <div
              key={d.day}
              title={`${d.day}: ${d.messages} ${d.messages === 1 ? "message" : "messages"}`}
              data-day={d.day}
              data-count={d.messages}
              style={{ height: `${Math.max(d.messages ? 6 : 2, Math.round((d.messages / max) * 100))}%` }}
              className={`min-w-0 flex-1 rounded-sm ${d.messages ? (i === stats.perDay.length - 1 ? "bg-arc" : "bg-arc-dim") : "bg-line"}`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint" aria-hidden>
          <span>{stats.perDay[0]?.day.slice(5)}</span>
          <span>today</span>
        </div>
        {/* The same numbers, for a screen reader (and for copying). */}
        <table className="sr-only">
          <caption>Messages per day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Messages</th>
            </tr>
          </thead>
          <tbody>
            {stats.perDay.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.messages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <section aria-labelledby="stats-tools">
          <h3 id="stats-tools" className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">Tools used</h3>
          {stats.tools.length === 0 ? (
            <p className="text-[12px] text-ink-faint">None yet.</p>
          ) : (
            <ul className="space-y-1 text-[12px]" data-tool-stats>
              {stats.tools.map((t) => (
                <li key={t.name} className="flex justify-between gap-3">
                  <span className="truncate font-mono text-ink-dim">{t.name}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {t.calls}
                    {t.errors > 0 && <span className="text-danger"> · {t.errors} failed</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="stats-models">
          <h3 id="stats-models" className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">Models that answered</h3>
          {stats.models.length === 0 ? (
            <p className="text-[12px] text-ink-faint">None yet.</p>
          ) : (
            <ul className="space-y-1 text-[12px]" data-model-stats>
              {stats.models.map((m) => (
                <li key={m.model} className="flex justify-between gap-3">
                  <span className="truncate font-mono text-ink-dim" title={m.model}>{m.model}</span>
                  <span className="shrink-0 font-mono tabular-nums">{m.replies}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {stats.speeds.length > 0 && (
        <section aria-labelledby="stats-speed" data-model-speeds>
          <h3 id="stats-speed" className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">How fast each model has answered</h3>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-ink-faint">
                <th scope="col" className="pb-1 font-normal">Model</th>
                <th scope="col" className="pb-1 text-right font-normal">Replies</th>
                <th scope="col" className="pb-1 text-right font-normal">Speed</th>
                <th scope="col" className="pb-1 text-right font-normal">First word</th>
              </tr>
            </thead>
            <tbody>
              {stats.speeds.map((m) => (
                <tr key={m.model} data-speed-row={m.model} className="border-t border-line-soft">
                  <td className="max-w-0 truncate py-1 pr-2 font-mono text-ink-dim" title={m.model}>{m.model}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{m.replies}</td>
                  <td className="py-1 text-right font-mono tabular-nums">~{m.tokensPerSecond} tok/s</td>
                  <td className="py-1 text-right font-mono tabular-nums">{m.firstTokenMs >= 1000 ? `${(m.firstTokenMs / 1000).toFixed(1)} s` : `${m.firstTokenMs} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-ink-faint">Measured in your browser, including the network. Speed is estimated from the length of each reply.</p>
        </section>
      )}

      {stats.recentTools.length > 0 && (
        <section aria-labelledby="stats-recent-tools" data-recent-tools>
          <h3 id="stats-recent-tools" className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">Latest tool calls</h3>
          <ul className="space-y-1 text-[12px]">
            {stats.recentTools.map((t, i) => (
              <li key={`${t.chatId}-${t.at}-${i}`} className="flex items-baseline gap-2" data-recent-tool={t.name}>
                <span className={`shrink-0 font-mono ${t.isError ? "text-danger" : "text-ink-dim"}`}>{t.name}</span>
                {t.isError && <span className="shrink-0 text-[10px] uppercase tracking-wide text-danger">failed</span>}
                <span className="min-w-0 flex-1 truncate text-ink-faint" title={t.chatTitle}>in {t.chatTitle}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">{t.ms} ms</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
