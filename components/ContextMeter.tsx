"use client";

import { formatTokens, type ContextInfo } from "@/lib/context-meter";

/** Below this the meter says nothing worth looking at, so it stays out of the way. */
const SHOW_FROM_TOKENS = 300;

const TONE = {
  ok: { text: "text-ink-faint", bar: "bg-ink-faint" },
  warn: { text: "text-warn", bar: "bg-warn" },
  full: { text: "text-danger", bar: "bg-danger" },
} as const;

/**
 * How full this request will be, by the same measure the server trims with.
 * Quiet until the conversation is long enough to matter; amber at 70%; red once
 * the oldest messages no longer fit and are being left out.
 */
export default function ContextMeter({ info }: { info: ContextInfo | null }) {
  if (!info || info.used < SHOW_FROM_TOKENS) return null;

  const tone = TONE[info.level];
  const percent = Math.min(100, Math.round(info.ratio * 100));
  const used = formatTokens(info.used);
  const limit = formatTokens(info.limit);
  const text = info.leftOut
    ? `older messages are being left out · ~${used} / ${limit}`
    : info.level === "warn"
      ? `getting long · ~${used} / ${limit}`
      : `~${used} / ${limit}`;

  return (
    <div
      role="meter"
      aria-label="Context used"
      aria-valuemin={0}
      aria-valuemax={info.limit}
      aria-valuenow={Math.min(info.used, info.limit)}
      aria-valuetext={text}
      data-context-meter
      data-level={info.level}
      title={
        "How much of what one request may hold this conversation fills, estimated from its length. " +
        "Once it is full the oldest messages are left out of what the model sees. " +
        "Memory notes JARVIS adds aren't counted."
      }
      className={`flex items-center gap-1.5 whitespace-nowrap ${tone.text}`}
    >
      <span className="h-1 w-14 overflow-hidden rounded-full bg-line" aria-hidden>
        <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${percent}%` }} />
      </span>
      <span>{text}</span>
    </div>
  );
}
