"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content, up to a ceiling, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!streaming) onSend();
    }
  }

  return (
    <div className="border-t border-line bg-base/95 px-3 py-3 backdrop-blur sm:px-6 sm:py-4">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-raised p-2 transition focus-within:border-arc-dim/60">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? "Ask JARVIS anything…"}
            className="max-h-[220px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          {streaming ? (
            <button
              onClick={onStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-dim ring-1 ring-line transition hover:text-danger"
              title="Stop generating"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={disabled || !value.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-arc-dim text-white transition hover:bg-arc disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-faint"
              title="Send (Enter)"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-[11px] text-ink-faint">
          Enter to send · Shift+Enter for a new line
        </div>
      </div>
    </div>
  );
}
