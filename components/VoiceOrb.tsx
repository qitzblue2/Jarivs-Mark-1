"use client";

import type { VoiceState } from "@/lib/voice/session";

const COLORS: Record<VoiceState, string> = {
  off: "#5d6880",
  loading: "#5d6880",
  idle: "#38bdf8",
  greeting: "#38bdf8",
  listening: "#4ade80",
  transcribing: "#fbbf24",
  thinking: "#fbbf24",
  speaking: "#38bdf8",
  error: "#f87171",
};

interface Props {
  state: VoiceState;
  /** Mic level 0-1, drives the reactive ring. */
  level: number;
}

/** The orb — its size tracks your voice, its colour tracks what JARVIS is doing. */
export default function VoiceOrb({ state, level }: Props) {
  const color = COLORS[state];
  const reactive = state === "listening" || state === "idle";
  const scale = reactive ? 1 + Math.min(level * 6, 0.5) : 1;
  const pulsing = state === "thinking" || state === "transcribing" || state === "loading";

  return (
    <div className="relative flex h-48 w-48 items-center justify-center">
      {/* Outer halo, driven by mic level */}
      <div
        className="absolute rounded-full transition-transform duration-100 ease-out"
        style={{
          width: 176,
          height: 176,
          background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`,
          transform: `scale(${scale})`,
        }}
      />
      {/* Ring */}
      <div
        className={`absolute rounded-full border-2 ${pulsing ? "animate-ping" : ""}`}
        style={{ width: 120, height: 120, borderColor: `${color}66` }}
      />
      {/* Core */}
      <div
        className="relative rounded-full transition-all duration-200"
        style={{
          width: 88,
          height: 88,
          background: `radial-gradient(circle at 35% 30%, ${color}, ${color}55)`,
          boxShadow: `0 0 48px ${color}55, inset 0 0 24px ${color}33`,
          transform: `scale(${reactive ? scale : 1})`,
        }}
      />
    </div>
  );
}
