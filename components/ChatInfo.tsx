"use client";

import { useMemo } from "react";
import { Info, X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";
import { chatInfo, spanLabel } from "@/lib/chat-info";
import { formatTime } from "@/lib/format";
import type { ContextInfo } from "@/lib/context-meter";
import type { Chat } from "@/lib/types";

interface Props {
  open: boolean;
  chat: Chat | null;
  /** How full the next request is, with the selected model. */
  context: ContextInfo | null;
  onClose: () => void;
}

const n = (v: number) => v.toLocaleString("en-US");

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-line bg-base px-3 py-2" data-info={label}>
      <dt className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="font-mono text-[15px] tabular-nums text-ink">{value}</dd>
      {detail && <dd className="text-[11px] text-ink-faint">{detail}</dd>}
    </div>
  );
}

/** The facts of one chat — its size, its models, its tools — and how much of the model's window the next message will use. */
export default function ChatInfo({ open, chat, context, onClose }: Props) {
  const ref = useDialogFocus(open);
  useEscape(open, onClose);
  const info = useMemo(() => (open && chat ? chatInfo(chat) : null), [open, chat]);
  if (!open || !chat || !info) return null;

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="chat-info-title" data-chat-info className="w-full max-w-lg rounded-xl border border-line bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="chat-info-title" className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Info size={15} className="shrink-0 text-arc" aria-hidden />
            <span className="truncate">About this chat</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink">
            <X size={16} />
          </button>
        </header>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4" tabIndex={0} role="region" aria-label="Facts about this chat">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label="Messages" value={n(info.messages.user + info.messages.assistant)} detail={`${n(info.messages.user)} yours · ${n(info.messages.assistant)} JARVIS`} />
            <Fact label="Words" value={n(info.words.user + info.words.assistant)} detail={`${n(info.words.user)} yours · ${n(info.words.assistant)} JARVIS`} />
            <Fact label="Size" value={`~${n(info.tokens)}`} detail="tokens, as the model counts it" />
            <Fact label="Started" value={info.firstAt ? formatTime(info.firstAt) : "—"} />
            <Fact label="Last message" value={info.lastAt ? formatTime(info.lastAt) : "—"} />
            <Fact label="Span" value={info.spanMs > 0 ? spanLabel(info.spanMs) : "—"} detail="first message to last" />
          </dl>

          {context && (
            <section aria-labelledby="info-context" data-info-context>
              <h3 id="info-context" className="mb-1.5 text-[10px] uppercase tracking-widest text-ink-faint">The next message</h3>
              <p className="text-[12.5px] leading-relaxed text-ink-dim">
                With the selected model, a request would hold about <strong className="font-mono text-ink">{n(context.used)}</strong> of the <strong className="font-mono text-ink">{n(context.limit)}</strong> tokens it can take
                {" "}({Math.round(context.ratio * 100)}%) — the conversation, your instructions, and the tool list.
                {context.leftOut ? " The oldest messages no longer fit and are being left out." : ""}
              </p>
            </section>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <section aria-labelledby="info-models">
              <h3 id="info-models" className="mb-1.5 text-[10px] uppercase tracking-widest text-ink-faint">Models that answered</h3>
              {info.models.length === 0 ? (
                <p className="text-[12px] text-ink-faint">None yet.</p>
              ) : (
                <ul className="space-y-1 text-[12px]">
                  {info.models.map((m) => (
                    <li key={m.model} className="flex justify-between gap-3">
                      <span className="truncate font-mono text-ink-dim" title={m.model}>{m.model}</span>
                      <span className="shrink-0 font-mono tabular-nums">{m.replies}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="info-other">
              <h3 id="info-other" className="mb-1.5 text-[10px] uppercase tracking-widest text-ink-faint">Along the way</h3>
              <ul className="space-y-1 text-[12px] text-ink-dim">
                <li>{info.tools.calls === 0 ? "No tools used" : `${n(info.tools.calls)} tool call${info.tools.calls === 1 ? "" : "s"}${info.tools.errors ? `, ${n(info.tools.errors)} failed` : ""}`}</li>
                <li>{info.attachments === 0 ? "No attachments" : `${n(info.attachments)} attachment${info.attachments === 1 ? "" : "s"}`}</li>
                <li>{info.starred === 0 ? "Nothing saved" : `${n(info.starred)} message${info.starred === 1 ? "" : "s"} saved`}</li>
                <li>{info.reactions.up + info.reactions.down === 0 ? "No ratings" : `${n(info.reactions.up)} 👍 · ${n(info.reactions.down)} 👎`}</li>
                {info.slowestMs !== null && <li>Slowest reply: {(info.slowestMs / 1000).toFixed(1)} s</li>}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
