"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Repeat, X, Zap } from "lucide-react";
import VoiceOrb from "./VoiceOrb";
import { DEFAULT_GREETING, VoiceSession, type VoiceState } from "@/lib/voice/session";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Sends the transcript through the normal chat path; returns the reply. */
  onQuestion: (text: string) => Promise<string>;
  greeting: string;
  ttsEngine: string;
  ttsVoice?: string;
  threshold: number;
  apiKey?: string;
  /** Starts recording immediately, skipping the wake word (mic button). */
  pushToTalk?: boolean;
}

const LABELS: Record<VoiceState, string> = {
  off: "Off",
  loading: "Warming up…",
  idle: 'Say "Hey JARVIS"',
  greeting: "…",
  listening: "Listening",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  speaking: "Speaking",
  error: "Something went wrong",
};

export default function VoiceMode({
  open, onClose, onQuestion, greeting, ttsEngine, ttsVoice, threshold, apiKey, pushToTalk,
}: Props) {
  const [state, setState] = useState<VoiceState>("off");
  const [level, setLevel] = useState(0);
  const [score, setScore] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [continuous, setContinuous] = useState(false);

  const session = useRef<VoiceSession | null>(null);
  // Kept in refs so the session and the key handler always see current values
  // without having to re-subscribe.
  const questionRef = useRef(onQuestion);
  questionRef.current = onQuestion;
  const stateRef = useRef(state);
  stateRef.current = state;

  const close = useCallback(() => {
    void session.current?.stop();
    session.current = null;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const instance = new VoiceSession(
      {
        greeting: greeting || DEFAULT_GREETING,
        ttsEngine,
        ttsVoice,
        continuous,
        pushToTalk,
        threshold,
        apiKey,
      },
      {
        onState: (next) => {
          setState(next);
          if (next === "listening") setNote(null);
        },
        onLevel: setLevel,
        onScore: setScore,
        onTranscript: setTranscript,
        onQuestion: (text) => questionRef.current(text),
        onError: setNote,
      },
    );

    session.current = instance;
    void instance.start().catch(() => {});

    return () => {
      void instance.stop();
      session.current = null;
    };
    // Recreating on every config change would drop the mic mid-sentence;
    // live changes go through updateConfig below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Push config changes into the running session without restarting it.
  useEffect(() => {
    session.current?.updateConfig({ greeting, ttsEngine, ttsVoice, threshold, continuous, apiKey });
  }, [greeting, ttsEngine, ttsVoice, threshold, continuous, apiKey]);

  const closeRef = useRef(close);
  closeRef.current = close;

  /**
   * Subscribe once per open, reading everything else from refs.
   *
   * This effect must NOT re-subscribe on each render. Workspace also listens
   * for Escape on window and was registered first, so its handler runs first
   * and updates state; React flushes that synchronously, and if this effect
   * then tore down and re-added its listener, the DOM would drop the original
   * listener mid-dispatch — the keypress would never reach it and Escape
   * would silently do nothing. Capture phase plus stopPropagation also makes
   * this modal win over the background handlers, which is what a modal should
   * do.
   */
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === " " && stateRef.current === "speaking") {
        e.preventDefault();
        e.stopPropagation();
        session.current?.interrupt();
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-base/97 backdrop-blur-lg">
      <button
        onClick={close}
        className="absolute right-4 top-4 rounded-lg p-2 text-ink-faint transition hover:bg-raised hover:text-ink"
        title="Exit voice mode (Esc)"
      >
        <X size={20} />
      </button>

      {!pushToTalk && (
        <button
          onClick={() => setContinuous((v) => !v)}
          className={`absolute left-4 top-4 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition ${
            continuous
              ? "border-arc-dim/50 bg-arc-dim/10 text-arc"
              : "border-line text-ink-faint hover:text-ink"
          }`}
          title="Keep listening after each answer"
        >
          <Repeat size={13} />
          {continuous ? "Continuous" : "Single question"}
        </button>
      )}

      <VoiceOrb state={state} level={level} />

      <div className="mt-6 text-center">
        <div className="text-[15px] font-medium text-ink">{LABELS[state]}</div>

        {state === "idle" && (
          <div className="mt-2 flex items-center justify-center gap-2">
            {/* Live confidence, so a mic that isn't working is obvious. */}
            <div className="h-1 w-32 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-arc transition-all duration-100"
                style={{ width: `${Math.min(100, (score / threshold) * 100)}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-ink-faint">{score.toFixed(2)}</span>
          </div>
        )}

        {transcript && (
          <p className="mx-auto mt-4 max-w-md px-6 text-[14px] leading-relaxed text-ink-dim">
            &ldquo;{transcript}&rdquo;
          </p>
        )}

        {note && (
          <p className="mx-auto mt-3 max-w-md px-6 text-[12px] text-warn">{note}</p>
        )}
      </div>

      <div className="absolute bottom-6 flex flex-col items-center gap-1 text-center text-[11px] text-ink-faint">
        <div className="flex items-center gap-1.5">
          <Zap size={11} className="text-arc" />
          Wake word runs locally — audio only leaves your machine after it fires
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Mic size={10} /> say &ldquo;stop&rdquo; to end
          </span>
          <span>Space interrupts · Esc exits</span>
        </div>
      </div>
    </div>
  );
}
