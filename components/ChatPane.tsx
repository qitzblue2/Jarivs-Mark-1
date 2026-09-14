"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, AudioLines, Code2, Info, Menu, Mic, Sparkles, X } from "lucide-react";
import Message from "./Message";
import Composer from "./Composer";
import ApprovalCard, { type PendingApproval } from "./ApprovalCard";
import ModelPicker, { type ProviderState } from "./ModelPicker";
import type { Attachment, Chat } from "@/lib/types";

interface Props {
  chat: Chat | null;
  streaming: boolean;
  streamingMessageId: string | null;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onRegenerate: (messageId: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onOpenInCanvas: (messageId: string, blockIndex: number) => void;
  providers: ProviderState[];
  provider: string;
  model: string;
  onModelChange: (provider: string, model: string) => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onToggleCanvas: () => void;
  canvasOpen: boolean;
  artifactCount: number;
  notice: string | null;
  onDismissNotice: () => void;
  /** true = push-to-talk (record now); false = wake-word voice mode. */
  onStartVoice: (pushToTalk: boolean) => void;
  attachments: Attachment[];
  onAttach: (attachments: Attachment[]) => void;
  onRemoveAttachment: (id: string) => void;
  onAttachError: (message: string) => void;
  approvals: PendingApproval[];
  onApprovalSettled: (id: string) => void;
}

const STARTERS = [
  "Build a bouncing ball animation in a single HTML file",
  "Explain how JavaScript promises work, with examples",
  "Write a Python script that renames files by their EXIF date",
  "Make a dark-themed pricing page with pure CSS",
];

export default function ChatPane(props: Props) {
  const {
    chat, streaming, streamingMessageId, input, onInputChange, onSend, onStop,
    onRegenerate, onEditMessage, onOpenInCanvas, providers, provider, model,
    onModelChange, onOpenSettings, onToggleSidebar, onToggleCanvas, canvasOpen,
    artifactCount, notice, onDismissNotice, onStartVoice,
    attachments, onAttach, onRemoveAttachment, onAttachError,
    approvals, onApprovalSettled,
  } = props;

  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const messages = chat?.messages ?? [];
  const lastId = messages[messages.length - 1]?.id;
  const tail = messages[messages.length - 1]?.content.length ?? 0;

  // Follow the stream, but stop fighting the user if they scroll up to read.
  useEffect(() => {
    if (!pinned) return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lastId, tail, pinned]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }

  // A local server with no key still counts as somewhere to send a message.
  const anyKey = providers.some((p) => p.ready);

  return (
    <div className="flex h-full min-w-0 flex-col bg-base">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button
          onClick={onToggleSidebar}
          className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink lg:hidden"
          title="Toggle chat list"
        >
          <Menu size={16} />
        </button>

        <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {chat?.title ?? "JARVIS Mark 5"}
        </h1>

        <ModelPicker
          providers={providers}
          provider={provider}
          model={model}
          onChange={onModelChange}
          onOpenSettings={onOpenSettings}
        />

        <button
          onClick={() => onStartVoice(true)}
          className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink"
          title="Speak a question"
        >
          <Mic size={16} />
        </button>

        <button
          onClick={() => onStartVoice(false)}
          className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-arc"
          title={'Voice mode — say "Hey JARVIS" (Ctrl/Cmd+J)'}
        >
          <AudioLines size={16} />
        </button>

        <button
          onClick={onToggleCanvas}
          className={`relative rounded-md p-1.5 transition hover:bg-raised ${
            canvasOpen ? "text-arc" : "text-ink-faint hover:text-ink"
          }`}
          title="Toggle code canvas"
        >
          <Code2 size={16} />
          {artifactCount > 0 && !canvasOpen && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-arc-dim px-1 text-[9px] font-bold text-white">
              {artifactCount}
            </span>
          )}
        </button>
      </header>

      {notice && (
        <div className="flex items-start gap-2 border-b border-line-soft bg-warn/10 px-4 py-2 text-[12px] text-warn">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={onDismissNotice} className="shrink-0 hover:text-ink" title="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}

      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-arc-dim/10 ring-1 ring-arc-dim/25">
                <Sparkles size={20} className="text-arc" />
              </div>
              <h2 className="mb-1 text-lg font-semibold">JARVIS Mark 5</h2>
              <p className="mb-5 text-[13px] text-ink-dim">
                {anyKey
                  ? "Running on free, fast inference. Ask for code and it opens in the canvas."
                  : "No API key yet — add a free one to get started."}
              </p>

              {anyKey ? (
                <div className="grid gap-1.5 text-left">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      onClick={() => onInputChange(starter)}
                      className="rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-ink-dim transition hover:border-arc-dim/40 hover:text-ink"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  onClick={onOpenSettings}
                  className="rounded-lg bg-arc-dim px-4 py-2 text-[13px] font-medium text-white transition hover:bg-arc"
                >
                  Add an API key
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <Message
                key={message.id}
                message={message}
                isStreaming={streaming && message.id === streamingMessageId}
                onRegenerate={
                  message.role === "assistant" && index === messages.length - 1 && !streaming
                    ? () => onRegenerate(message.id)
                    : undefined
                }
                onEdit={
                  message.role === "user" && !streaming
                    ? (content) => onEditMessage(message.id, content)
                    : undefined
                }
                onOpenInCanvas={onOpenInCanvas}
              />
            ))}
            {approvals.length > 0 && (
              <div className="px-4 sm:px-6">
                <div className="mx-auto max-w-3xl">
                  {approvals.map((approval) => (
                    <ApprovalCard
                      key={approval.id}
                      approval={approval}
                      onSettled={onApprovalSettled}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="h-4" />
          </>
        )}

        {!pinned && messages.length > 0 && (
          <button
            onClick={() => {
              setPinned(true);
              scroller.current?.scrollTo({
                top: scroller.current.scrollHeight,
                behavior: "smooth",
              });
            }}
            className="sticky bottom-4 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-raised text-ink-dim shadow-lg transition hover:text-ink"
            title="Jump to latest"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>

      <Composer
        value={input}
        onChange={onInputChange}
        onSend={onSend}
        onStop={onStop}
        streaming={streaming}
        attachments={attachments}
        onAttach={onAttach}
        onRemoveAttachment={onRemoveAttachment}
        onAttachError={onAttachError}
        disabled={!anyKey}
        placeholder={anyKey ? "Ask JARVIS anything…" : "Add an API key in Settings to start"}
      />
    </div>
  );
}
