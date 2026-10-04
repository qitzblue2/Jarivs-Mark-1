"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { splitReasoning } from "@/lib/reasoning";
import { readingLabel, toPlainText } from "@/lib/reading";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, FileText, GitBranch, Pencil, Quote, RefreshCw, Square, Star, ThumbsDown, ThumbsUp, Volume2, X } from "lucide-react";
import { describeStats, formatTime, isLongMessage } from "@/lib/format";
import Markdown from "./Markdown";
import ToolTrace from "./ToolTrace";
import Attachments from "./Attachments";
import ModelPicker from "./ModelPicker";
import { useModels } from "./models-context";
import type { Message as MessageType } from "@/lib/types";

interface Props {
  message: MessageType;
  isStreaming: boolean;
  /** Whether to offer the action — separate from the handler, which is shared. */
  canRegenerate?: boolean;
  canEdit?: boolean;
  /**
   * Handlers take the message id rather than being pre-bound per message.
   *
   * The pre-bound version meant a fresh closure for every message on every
   * render of the list, which is what made the memo below useless and left
   * react-markdown re-highlighting the whole conversation on each keystroke.
   */
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onOpenInCanvas?: (messageId: string, blockIndex: number) => void;
  /** Start a new chat from this message, leaving this one as it is. */
  onBranch?: (messageId: string) => void;
  /** Save or unsave this message; saved ones are listed under Saved. */
  onStar?: (messageId: string) => void;
  /** Read this message aloud, or stop if it already is. */
  onSpeak?: (messageId: string) => void;
  /** Whether this message is being read aloud right now. */
  speaking?: boolean;
  /** Rate a reply 👍 or 👎; pressing the same one again takes it back. */
  onReact?: (messageId: string, reaction: "up" | "down") => void;
  /** Start your next message with this one quoted. */
  onQuote?: (messageId: string) => void;
}

function MessageBody({
  message,
  isStreaming,
  canRegenerate,
  canEdit,
  onRegenerate,
  onEdit,
  onOpenInCanvas,
  onBranch,
  onStar,
  onSpeak,
  speaking,
  onReact,
  onQuote,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const models = useModels();

  // Bound to this message here rather than by the list, so the props coming
  // in stay reference-stable and the memo below can actually bail out.
  const regenerateThis = useCallback(
    () => onRegenerate?.(message.id),
    [onRegenerate, message.id],
  );
  const openBlockInCanvas = useCallback(
    (index: number) => onOpenInCanvas?.(message.id, index),
    [onOpenInCanvas, message.id],
  );

  // Split once per render: a thinking model's reasoning must not be rendered
  // as if it were the reply, and `forSpeech` drops it for the same reason.
  const { reasoning, answer, thinking } = splitReasoning(message.content);
  const isUser = message.role === "user";
  // Pasted logs and files are folded; replies are meant to be read in full.
  const long = isUser && isLongMessage(message.content);

  // How long a long reply takes to read, once it has finished arriving.
  const reading = useMemo(() => (message.role === "assistant" && !isStreaming ? readingLabel(message.content) : null), [message.role, message.content, isStreaming]);

  async function copyPlain() {
    try {
      await navigator.clipboard.writeText(toPlainText(splitReasoning(message.content).answer || message.content));
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

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
    if (next && next !== message.content) onEdit?.(message.id, next);
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
            className="w-full resize-y rounded-lg border border-arc-dim bg-raised p-3 chat-text text-ink outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={saveEdit}
              className="rounded-md bg-arc-solid px-3 py-1.5 text-sm font-medium text-white transition hover:bg-arc-solid-hover"
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
      id={`msg-${message.id}`}
      data-msg
      data-role={message.role}
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
          {!isUser && (message.model || message.fellBackFrom || message.stats || message.reaction || message.starred || reading) && (
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
              {message.model && <span className="font-mono">{message.model}</span>}
              {reading && <span data-reading>{reading}</span>}
              {message.stats && (
                <span data-stats title="Measured in your browser. Speed is estimated from the length of the reply.">
                  {describeStats(message.stats)}
                </span>
              )}
              {message.starred && <Star size={11} className="fill-warn text-warn" aria-label="Saved" />}
              {message.reaction && (
                <span data-reaction-mark={message.reaction} className="flex items-center" title={message.reaction === "up" ? "You rated this reply helpful" : "You rated this reply not helpful"}>
                  {message.reaction === "up" ? <ThumbsUp size={11} className="text-ok" aria-hidden /> : <ThumbsDown size={11} className="text-warn" aria-hidden />}
                  <span className="sr-only">{message.reaction === "up" ? "Rated helpful" : "Rated not helpful"}</span>
                </span>
              )}
              {message.fellBackFrom && (
                <span className="flex items-center gap-1 rounded bg-warn/10 px-1.5 py-0.5 text-warn">
                  <AlertTriangle size={10} />
                  {message.fellBackFrom} was unavailable — answered by {message.provider}
                </span>
              )}
            </div>
          )}

          {isUser ? (
            <div>
              {message.attachments && message.attachments.length > 0 && (
                <Attachments attachments={message.attachments} />
              )}
              <div
                className={`relative whitespace-pre-wrap break-words chat-text leading-relaxed ${
                  long && !expanded ? "max-h-64 overflow-hidden" : ""
                }`}
                data-collapsed={long && !expanded ? "true" : undefined}
              >
                {message.content}
                {long && !expanded && (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-base to-transparent" />
                )}
              </div>
              {long && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 text-[12px] text-arc transition hover:underline"
                  aria-expanded={expanded}
                >
                  {expanded ? "Show less" : `Show all (${message.content.split("\n").length} lines)`}
                </button>
              )}
            </div>
          ) : (
            <>
              {message.toolRounds && message.toolRounds.length > 0 && (
                <ToolTrace rounds={message.toolRounds} pending={isStreaming} />
              )}
              {/* Thinking models emit their reasoning inline. Kept, because
                  it is often the interesting part, but folded away — it is
                  working-out, not an answer. */}
              {reasoning && <Reasoning text={reasoning} pending={thinking && isStreaming} />}
              <Markdown
                content={answer}
                onOpenInCanvas={onOpenInCanvas ? openBlockInCanvas : undefined}
              />
              {isStreaming && !answer && !reasoning && (
                <span className="streaming-caret text-ink-faint">
                  {message.toolRounds?.length ? "Working" : "Thinking"}
                </span>
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
            <div data-no-find className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <button
                onClick={copyAll}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
              >
                {copied ? <Check size={12} className="text-arc" /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </button>
              {!isUser && message.content && (
                <button
                  onClick={copyPlain}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                  title="Copy as plain text — no asterisks or hashes"
                  data-copy-text
                >
                  {copiedText ? <Check size={12} className="text-arc" /> : <FileText size={12} />}
                  {copiedText ? "Copied" : "Copy text"}
                </button>
              )}
              {onQuote && message.content && (
                <button
                  onClick={() => onQuote(message.id)}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                  title="Start your next message by quoting this one"
                  data-quote
                >
                  <Quote size={12} />
                  Quote
                </button>
              )}
              {isUser && canEdit && onEdit && (
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
              {onStar && (
                <button
                  onClick={() => onStar(message.id)}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                  title={message.starred ? "Remove from Saved" : "Save this message"}
                  aria-pressed={Boolean(message.starred)}
                >
                  <Star size={12} className={message.starred ? "fill-warn text-warn" : ""} />
                  {message.starred ? "Saved" : "Save"}
                </button>
              )}
              {!isUser && onSpeak && (
                <button
                  onClick={() => onSpeak(message.id)}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                  title={speaking ? "Stop reading" : "Read this reply aloud"}
                  aria-pressed={Boolean(speaking)}
                >
                  {speaking ? <Square size={11} className="fill-arc text-arc" /> : <Volume2 size={12} />}
                  {speaking ? "Stop" : "Listen"}
                </button>
              )}
              {!isUser && onReact && !message.error && message.content && (
                <>
                  <button
                    onClick={() => onReact(message.id, "up")}
                    className="flex items-center rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                    title="Good reply"
                    aria-label="Good reply"
                    aria-pressed={message.reaction === "up"}
                    data-react="up"
                  >
                    <ThumbsUp size={12} className={message.reaction === "up" ? "fill-ok text-ok" : ""} aria-hidden />
                  </button>
                  <button
                    onClick={() => onReact(message.id, "down")}
                    className="flex items-center rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                    title="Not helpful"
                    aria-label="Not helpful"
                    aria-pressed={message.reaction === "down"}
                    data-react="down"
                  >
                    <ThumbsDown size={12} className={message.reaction === "down" ? "fill-warn text-warn" : ""} aria-hidden />
                  </button>
                </>
              )}
              {onBranch && (
                <button
                  onClick={() => onBranch(message.id)}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                  title="Start a new chat from here, keeping this one as it is"
                >
                  <GitBranch size={12} />
                  Branch
                </button>
              )}
              {!isUser && canRegenerate && onRegenerate && (
                <button
                  onClick={regenerateThis}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
                >
                  <RefreshCw size={12} />
                  Regenerate
                </button>
              )}
              {!isUser && canRegenerate && onRegenerate && models && (
                <ModelPicker
                  bare
                  placement="auto"
                  label="Regenerate with another model"
                  providers={models.providers}
                  provider={message.provider ?? ""}
                  model={message.model ?? ""}
                  onChange={(provider, model) => models.onRegenerateWith(message.id, provider, model)}
                  onOpenSettings={models.onOpenSettings}
                  favorites={models.favorites}
                  onToggleFavorite={models.onToggleFavorite}
                  trigger={({ open, toggle }) => (
                    <button
                      onClick={toggle}
                      aria-haspopup="dialog"
                      aria-expanded={open}
                      aria-label="Regenerate with another model"
                      title="Regenerate with another model"
                      data-regenerate-with
                      className="rounded px-1 py-1 text-ink-faint transition hover:bg-raised hover:text-ink"
                    >
                      <ChevronDown size={12} />
                    </button>
                  )}
                />
              )}
              <time
                dateTime={new Date(message.createdAt).toISOString()}
                title={new Date(message.createdAt).toLocaleString()}
                className="ml-auto pl-2 text-[11px] text-ink-faint"
                data-message-time
              >
                {formatTime(message.createdAt)}
              </time>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Memoised because the list re-renders on every keystroke in the composer,
 * and each message runs splitReasoning over its whole content and hands
 * react-markdown — with syntax highlighting — the result. Bailing out here is
 * the difference between doing that once and doing it for every message in
 * the conversation, per character typed.
 */
export default memo(MessageBody);

/**
 * A thinking model's working-out, folded away.
 *
 * Deleting it would be easier and worse: when a reasoning model gets
 * something wrong, the reasoning is where you find out why. Collapsed by
 * default because it is usually longer than the answer.
 */
function Reasoning({ text, pending }: { text: string; pending: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-ink-faint transition hover:text-ink-dim"
      >
        <ChevronRight
          size={11}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        {pending ? "Thinking…" : `Thought for ${text.split(/\s+/).length} words`}
      </button>
      {open && (
        <div className="mt-1 whitespace-pre-wrap border-l-2 border-line py-0.5 pl-2.5 text-[12.5px] leading-relaxed text-ink-faint">
          {text}
        </div>
      )}
    </div>
  );
}
