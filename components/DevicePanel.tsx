"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Mic, MicOff, Play, Radio, Square, Volume2 } from "lucide-react";

/**
 * Device voice: what the box in the room is doing, and why it isn't.
 *
 * Every failure this panel reports is physical — no microphone, no ALSA, no
 * voice model, a Bluetooth speaker that wandered off — and none of them can
 * be fixed in code. Naming the specific one is the entire job.
 */

interface DeviceStatus {
  deviceMode: boolean;
  running: boolean;
  device: {
    deviceClass: string;
    arch: string;
    model: string;
    cores: number;
    totalMemoryMb: number;
    suggestedQuality: string;
  };
  audio: { capture: boolean; playback: boolean; inputs: string[]; outputs: string[]; problem?: string };
  piper: { installed: boolean; voices: string[]; problem?: string; catalogue: { id: string; label: string }[] };
  diagnostics: {
    state: string;
    frames: number;
    scored: number;
    backlog: number;
    level: number;
    peakLevel: number;
    wakeScore: number;
    peakWakeScore: number;
    speechProbability: number;
    muted: boolean;
    armed: boolean;
    turns: number;
    lastTranscript: string;
    lastReply: string;
    responseMs: number;
  } | null;
  error: string | null;
  log: { at: number; kind: string; text: string }[];
}

type Action = "start" | "stop" | "mute" | "unmute" | "interrupt" | "config";

export default function DevicePanel() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [voice, setVoice] = useState("");
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/device");
      if (!res.ok) return;
      const json = (await res.json()) as DeviceStatus;
      if (mounted.current) setStatus(json);
    } catch {
      // The panel is diagnostics; a failed poll isn't worth its own error.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    // Poll only while something is live — the meters are the reason to look.
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  const send = async (action: Action, config?: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, config }),
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

  if (!status) {
    return <p className="text-[11px] text-ink-faint">Checking this machine…</p>;
  }

  const { device, audio, piper, diagnostics } = status;
  const blockers = [audio.problem, piper.problem].filter(Boolean) as string[];
  const level = diagnostics?.level ?? 0;

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] leading-relaxed text-ink-faint">
        {device.model === "unknown" ? `${device.deviceClass} machine` : device.model} ·{" "}
        {device.arch} · {device.cores} cores · {Math.round(device.totalMemoryMb / 1024)}GB —{" "}
        <span className="text-ink-dim">{device.suggestedQuality}</span> voice suits it.
      </p>

      {/* Hardware, one line each, because one of them is always the answer. */}
      <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
        <Check ok={audio.capture && audio.inputs.length > 0} label="microphone" />
        <Check ok={audio.playback} label="speaker" />
        <Check ok={piper.installed} label="voice" />
      </div>

      {blockers.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warn/30 bg-warn/5 px-2.5 py-2 text-[11px] leading-relaxed text-warn">
          {blockers.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => void send(status.running ? "stop" : "start", { requireWakeWord: !alwaysOn, voice: voice || undefined })}
          disabled={busy || blockers.length > 0}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:border-arc-dim/50 hover:text-arc disabled:opacity-40"
        >
          {status.running ? <Square size={11} /> : <Play size={11} />}
          {status.running ? "Stop listening" : "Start listening"}
        </button>

        {status.running && (
          <button
            onClick={() => void send(diagnostics?.muted ? "unmute" : "mute")}
            disabled={busy}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition disabled:opacity-40 ${
              diagnostics?.muted
                ? "border-warn/40 bg-warn/10 text-warn"
                : "border-line text-ink-dim hover:text-ink"
            }`}
          >
            {diagnostics?.muted ? <MicOff size={11} /> : <Mic size={11} />}
            {diagnostics?.muted ? "Muted" : "Mute"}
          </button>
        )}

        <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
          <input
            type="checkbox"
            checked={alwaysOn}
            onChange={(e) => {
              setAlwaysOn(e.target.checked);
              if (status.running) void send("config", { requireWakeWord: !e.target.checked });
            }}
            className="accent-[var(--color-arc)]"
          />
          Answer without the wake word
        </label>
      </div>

      {piper.catalogue.length > 0 && (
        <label className="flex items-center gap-2 text-[11px] text-ink-dim">
          <Volume2 size={11} className="shrink-0 text-ink-faint" />
          <select
            value={voice}
            onChange={(e) => {
              setVoice(e.target.value);
              if (status.running) void send("config", { voice: e.target.value || undefined });
            }}
            className="flex-1 rounded-md border border-line bg-base px-2 py-1 text-[11px] text-ink"
          >
            <option value="">Best for this machine</option>
            {piper.catalogue
              .filter((v) => piper.voices.some((file) => file.startsWith(v.id)))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
          </select>
        </label>
      )}

      {status.running && diagnostics && (
        <div className="space-y-1.5 rounded-md border border-line-soft bg-base px-2.5 py-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-ink">
              <Radio size={11} className={diagnostics.muted ? "text-ink-faint" : "text-arc"} />
              {diagnostics.muted ? "muted" : diagnostics.state}
              {diagnostics.armed && !diagnostics.muted && <span className="text-arc">· listening for you</span>}
            </span>
            <span className="font-mono text-[10px] text-ink-faint">
              {diagnostics.turns} turn{diagnostics.turns === 1 ? "" : "s"}
            </span>
          </div>

          {/* A flat bar here means the microphone, not the models. */}
          <div className="flex items-center gap-2">
            <Mic size={10} className="shrink-0 text-ink-faint" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full transition-all duration-100 ${level > 0.01 ? "bg-green-400" : "bg-ink-faint"}`}
                style={{ width: `${Math.min(100, level * 400)}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-faint">
              {level.toFixed(3)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Activity size={10} className="shrink-0 text-ink-faint" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-arc transition-all duration-100"
                style={{ width: `${Math.min(100, diagnostics.speechProbability * 100)}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-faint">
              {diagnostics.speechProbability.toFixed(2)}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-2.5 font-mono text-[9.5px] text-ink-faint">
            <span>{diagnostics.frames} frames</span>
            <span>scored {diagnostics.scored}</span>
            {/* Backlog is the honest "this machine is too slow" signal. */}
            <span className={diagnostics.backlog > 5 ? "text-warn" : undefined}>
              backlog {diagnostics.backlog}
            </span>
            <span>wake {diagnostics.peakWakeScore.toFixed(2)}</span>
            {diagnostics.responseMs > 0 && <span>reply {(diagnostics.responseMs / 1000).toFixed(1)}s</span>}
          </div>

          {diagnostics.lastTranscript && (
            <p className="truncate text-[11px] text-ink-dim">
              heard &ldquo;{diagnostics.lastTranscript}&rdquo;
            </p>
          )}
        </div>
      )}

      {(note || status.error) && (
        <p className="text-[11px] leading-relaxed text-warn">{note ?? status.error}</p>
      )}

      {!status.deviceMode && (
        <p className="text-[10.5px] leading-relaxed text-ink-faint">
          Set <code className="font-mono">JARVIS_DEVICE_MODE=1</code> to start this automatically
          when the machine boots.
        </p>
      )}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${
        ok ? "border-green-400/30 bg-green-400/5 text-green-400" : "border-line text-ink-faint"
      }`}
    >
      {ok ? "●" : "○"} {label}
    </span>
  );
}
