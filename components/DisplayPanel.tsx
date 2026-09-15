"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, MonitorOff, Power, Trash2 } from "lucide-react";

/**
 * The room display: is anything looking at it, and what is on it.
 *
 * Same job as DevicePanel. Everything that goes wrong here is physical — no
 * kiosk running, a projector with CEC switched off in its own menu, an HDMI
 * port that doesn't carry CEC — and naming which one is the entire value.
 */

interface Status {
  connected: number;
  content: { kind: string; title?: string; body?: string } | null;
  view: string;
  since: number | null;
  power: { available: boolean; method: string | null; on: boolean | null; problem?: string };
}

export default function DisplayPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/display");
      if (!res.ok) return;
      const json = (await res.json()) as Status;
      if (mounted.current) setStatus(json);
    } catch {
      /* diagnostics; a failed poll is not itself worth reporting */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setNote(json.error ?? `Failed (${res.status}).`);
      await refresh();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <p className="text-[11px] text-ink-faint">Checking the display…</p>;

  const live = status.connected > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11.5px]">
        {live ? (
          <Monitor size={12} className="shrink-0 text-green-400" />
        ) : (
          <MonitorOff size={12} className="shrink-0 text-ink-faint" />
        )}
        <span className={live ? "text-ink" : "text-ink-faint"}>
          {live
            ? `${status.connected} display${status.connected === 1 ? "" : "s"} connected`
            : "No display connected"}
        </span>
        {status.power.method && (
          <span className="ml-auto rounded bg-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-dim">
            {status.power.method}
          </span>
        )}
      </div>

      {!live && (
        <p className="text-[10.5px] leading-relaxed text-ink-faint">
          Open <code className="font-mono">/display</code> on the screen, or on the Pi run{" "}
          <code className="font-mono">chromium --kiosk http://localhost:3000/display</code>.
        </p>
      )}

      {status.power.problem && (
        <p className="rounded-md border border-warn/30 bg-warn/5 px-2.5 py-2 text-[11px] leading-relaxed text-warn">
          {status.power.problem}
        </p>
      )}

      {status.content && (
        <p className="truncate text-[11px] text-ink-dim">
          Showing{" "}
          <span className="text-ink">{status.content.title ?? status.content.kind}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() =>
            void send({
              action: "show",
              content: {
                kind: "markdown",
                title: "JARVIS",
                body: "Display test — if you can read this from across the room, it works.",
              },
            })
          }
          disabled={busy}
          className="rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:border-arc-dim/50 hover:text-arc disabled:opacity-40"
        >
          Test
        </button>
        <button
          onClick={() => void send({ action: "clear" })}
          disabled={busy || !status.content}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:text-ink disabled:opacity-40"
        >
          <Trash2 size={11} /> Clear
        </button>
        <button
          onClick={() => void send({ action: "power", on: !(status.power.on ?? false) })}
          disabled={busy || !status.power.available}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:text-ink disabled:opacity-40"
        >
          <Power size={11} /> Turn {status.power.on ? "off" : "on"}
        </button>
      </div>

      {note && <p className="text-[11px] leading-relaxed text-warn">{note}</p>}
    </div>
  );
}
