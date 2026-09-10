"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, Pencil, RefreshCw, X } from "lucide-react";
import Markdown from "./Markdown";
import type { Message as MessageType } from "@/lib/types";

interface Props {
  message: MessageType;
  isStreaming: boolean;
  onRegenerate?: () => void;
  onEdit?: (content: string) => void;
  onOpenInCanvas?: (messageId: string, blockIndex: number) => void;
}

export default function Message({
  message,
  isStreaming,
  onRegenerate,
  onEdit,
  onOpenInCanvas,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function saveEdit() {
    const next = draft.trim();
    if (next && next !== message.content) onEdit?.(next);
    setEditing(false);
  }

  if (isUser && editing) {
    return (
      <div className="px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
            }}
            autoFocus
            rows={Math.min(14, draft.split("\n").length + 1)}
            className="w-full resize-y rounded-lg border border-arc-dim bg-raised p-3 text-[15px] text-ink outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={saveEdit}
              className="rounded-md bg-arc-dim px-3 py-1.5 text-sm font-medium text-white transition hover:bg-arc"
            >
              Save &amp; resend
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-dim transition hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group px-4 py-5 sm:px-6 ${isUser ? "" : "border-y border-line-soft bg-panel/40"}`}
    >
      <div className="mx-auto flex max-w-3xl gap-3 sm:gap-4">
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold tracking-wider ${
            isUser
              ? "bg-raised text-ink-dim"
              : "bg-arc-dim/15 text-arc ring-1 ring-arc-dim/30"
          }`}
        >
          {isUser ? "YOU" : "J"}
        </div>

        <div className="min-w-0 flex-1">
          {!isUser && (message.model || message.fellBackFrom) && (
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
              {message.model && <span className="font-mono">{message.model}</span>}
              {message.fellBackFrom && (
                <span className="flex items-center gap-1 rounded bg-warn/10 px-1.5 py-0.5 text-warn">
                  <AlertTriangle size={10} />
                  {message.fellBackFrom} was unavailable — answered by {message.provider}
                </span>
              )}
            </div>
          )}

          {isUser ? (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              {message.content}
            </div>
          ) : (
            <>
              <Markdown
                content={message.content}
                onOpenInCanvas={
                  onOpenInCanvas ? (index) => onOpenInCanvas(message.id, index) : undefined
                }
              />
              {isStreaming && !message.content && (
                <span className="streaming-caret text-ink-faint">Thinking</span>
              )}
            </>
          )}

          {message.error && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{message.error}</span>
            </div>
          )}

          {!isStreaming && (
            <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              <button
                onClick={copyAll}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
              >
                {copied ? <Check size={12} className="text-arc" /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </button>
              {isUser && onEdit && (
                <button
                  onClick={() => {
                    setDraft(message.content);
                    setEditing(true);
                  }}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                >
                  <Pencil size={12} />
                  Edit
                </button>
              )}
              {!isUser && onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                >
                  <RefreshCw size={12} />
                  Regenerate
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
