"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, AudioLines, Code2, FileDown, GitBranch, Info, Menu, Mic, SlidersHorizontal, Sparkles, X } from "lucide-react";
import Message from "./Message";
import ContextMeter from "./ContextMeter";
import Welcome, { type QuickActionId } from "./Welcome";
import type { ChatMeta } from "@/lib/types";
import type { ContextInfo } from "@/lib/context-meter";
import Composer from "./Composer";
import InitiativeBar from "./InitiativeBar";
import ChatTools from "./ChatTools";
import FindBar from "./FindBar";
import ChatInfo from "./ChatInfo";
import { pickJump } from "@/lib/reading";
import type { ReplyLength } from "@/lib/composing";
import Suggestions from "./Suggestions";
import ApprovalCard, { type PendingApproval } from "./ApprovalCard";
import ModelPicker, { type ProviderState } from "./ModelPicker";
import type { Attachment, Chat } from "@/lib/types";
import type { SavedPrompt } from "@/lib/prompts";
import type { SlashMatch } from "@/lib/slash";

interface Props {
  chat: Chat | null;
  streaming: boolean;
  streamingMessageId: string | null;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (task?: boolean) => void;
  onStop: () => void;
  onRegenerate: (messageId: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onOpenInCanvas: (messageId: string, blockIndex: number) => void;
  onBranch: (messageId: string) => void;
  onStar: (messageId: string) => void;
  onSpeak: (messageId: string) => void;
  /** The message being read aloud, if any. */
  speakingId: string | null;
  prompts: SavedPrompt[];
  onSlash: (match: SlashMatch) => void;
  /** Open the dialog for this chat's own instructions. */
  onEditInstructions: () => void;
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
  /** How full the next request is, for the meter beside the message box. */
  context: ContextInfo | null;
  favorites: string[];
  onToggleFavorite: (provider: string, model: string) => void;
  modelNotes: Record<string, string>;
  replyLength: ReplyLength;
  onReplyLength: (length: ReplyLength) => void;
  /** For the welcome screen: where you left off, and the quick actions. */
  recent: ChatMeta[];
  onOpenChat: (id: string) => void;
  onQuickAction: (id: QuickActionId) => void;
  onReact: (messageId: string, reaction: "up" | "down") => void;
  onQuote: (messageId: string) => void;
  onRemember: (messageId: string, selection: string) => void;
  onOpenNotes: () => void;
  onOpenInbox: () => void;
  temperature: number;
  onTemperature: (value: number) => void;
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
    onRegenerate, onEditMessage, onOpenInCanvas, onBranch, onStar, onSpeak, speakingId, prompts, onSlash, onEditInstructions, providers, provider, model,
    onModelChange, onOpenSettings, onToggleSidebar, onToggleCanvas, canvasOpen,
    artifactCount, notice, onDismissNotice, onStartVoice,
    attachments, onAttach, onRemoveAttachment, onAttachError,
    approvals, onApprovalSettled, context, favorites, onToggleFavorite, modelNotes, replyLength, onReplyLength, recent, onOpenChat, onQuickAction,
    onReact, onQuote, onRemember, onOpenNotes, onOpenInbox, temperature, onTemperature,
  } = props;

  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const messages = chat?.messages ?? [];
  // What you've sent here, for the composer's up arrow. Memoised on the list
  // itself so the composer isn't handed a new array — and told to forget
  // where it was in your history — on every keystroke.
  const sent = useMemo(
    () => (chat?.messages ?? []).filter((m) => m.role === "user" && m.content.trim()).map((m) => m.content),
    [chat?.messages],
  );
  const lastId = messages[messages.length - 1]?.id;
  const tail = messages[messages.length - 1]?.content.length ?? 0;

  // Follow the stream, but stop fighting the user if they scroll up to read.
  useEffect(() => {
    if (!pinned) return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lastId, tail, pinned]);

  // Ctrl/Cmd+Shift+F finds in this chat; Alt+Up/Down moves between your messages.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      // In a box with something typed in it, Alt+arrows belong to the text.
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
      if ((target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") && target.value) return;
      const box = scroller.current;
      if (!box) return;
      const mine = [...box.querySelectorAll<HTMLElement>('[data-msg][data-role="user"]')];
      const top = box.getBoundingClientRect().top;
      const at = pickJump(mine.map((el) => el.getBoundingClientRect().top - top), e.key === "ArrowUp" ? "up" : "down");
      if (at === null) return;
      e.preventDefault();
      mine[at].scrollIntoView({ block: "start" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1800);
  }

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }

  // Somewhere that can actually answer — not merely a slot that exists. The
  // self-hosted slot is always "ready" even with nothing behind it, so asking
  // only about readiness showed prompt starters to a brand-new install that
  // could not respond to any of them.
  const anyKey = providers.some((p) => p.ready && p.models.length > 0);

  return (
    <div className="flex h-full min-w-0 flex-col bg-base" data-print-flow>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button
          onClick={onToggleSidebar}
          className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink lg:hidden"
          title="Toggle chat list"
        >
          <Menu size={16} />
        </button>

        <h1 className="flex min-w-0 flex-1 items-center gap-2 truncate text-[13px] font-medium">
          <span className="truncate">{chat?.title ?? "JARVIS Mark 6"}</span>
          {chat?.branchedFrom && (
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-normal text-ink-faint" title="Branched or copied from another chat">
              <GitBranch size={10} /> {chat.branchedFrom.messageId ? "branch" : "copy"}
            </span>
          )}
        </h1>

        <InitiativeBar onOpenInbox={onOpenInbox} />

        {chat && chat.messages.length > 0 && (
          <ChatTools chatId={chat.id} messages={chat.messages} hasNotes={Boolean(chat.notes)} onFind={() => setFindOpen(true)} onJump={jumpTo} onNotes={onOpenNotes} onInfo={() => setInfoOpen(true)} />
        )}

        {chat && (
          <button
            onClick={onEditInstructions}
            className={`rounded-md p-1.5 transition hover:bg-raised ${chat.persona ? "text-arc" : "text-ink-faint hover:text-ink"}`}
            title={chat.persona ? "This chat has its own instructions" : "Give this chat its own instructions"}
            data-chat-instructions
          >
            <SlidersHorizontal size={16} />
          </button>
        )}

        <ModelPicker
          providers={providers}
          provider={provider}
          model={model}
          onChange={onModelChange}
          onOpenSettings={onOpenSettings}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          notes={modelNotes}
        />

        {chat && chat.messages.length > 0 && (
          <a
            href={`/api/chats/${chat.id}/export`}
            className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink"
            title="Export this chat as Markdown"
          >
            <FileDown size={16} />
          </a>
        )}

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
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-arc-solid px-1 text-[9px] font-bold text-white">
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

      <FindBar
        open={findOpen && messages.length > 0}
        onClose={() => {
          setFindOpen(false);
          document.getElementById("message-input")?.focus();
        }}
        scope={scroller}
        revision={`${chat?.id}:${messages.length}:${tail}`}
      />

      <div
        ref={scroller}
        onScroll={onScroll}
        id="conversation"
        role="log"
        aria-label="Conversation"
        // Streamed text arrives a few characters at a time; reading each one out
        // would be unusable. The status line below announces start and finish.
        aria-live="off"
        tabIndex={0}
        data-print-flow
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-xl text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-arc-dim/10 ring-1 ring-arc-dim/25">
                <Sparkles size={20} className="text-arc" />
              </div>
              <h2 className="mb-1 text-lg font-semibold">JARVIS Mark 6</h2>
              <p className="mb-5 text-[13px] text-ink-dim">
                {anyKey
                  ? "Running on free, fast inference. Ask for code and it opens in the canvas."
                  : "No API key yet — add a free one to get started."}
              </p>

              {anyKey ? (
                <Welcome
                  starters={STARTERS}
                  onPick={onInputChange}
                  recent={recent}
                  onOpenChat={onOpenChat}
                  onAction={onQuickAction}
                />
              ) : (
                <button
                  onClick={onOpenSettings}
                  className="rounded-lg bg-arc-solid px-4 py-2 text-[13px] font-medium text-white transition hover:bg-arc-solid-hover"
                >
                  Add an API key
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Every prop here is a primitive or a stable reference, which is
                what lets Message memoise. Passing `() => onRegenerate(id)` and
                `(content) => onEditMessage(id, content)` instead — a fresh
                closure per message per render — re-highlighted every message
                in the conversation on each keystroke in the composer. */}
            {messages.map((message, index) => (
              <Message
                key={message.id}
                message={message}
                isStreaming={streaming && message.id === streamingMessageId}
                canRegenerate={
                  message.role === "assistant" && index === messages.length - 1 && !streaming
                }
                canEdit={message.role === "user" && !streaming}
                onRegenerate={onRegenerate}
                onEdit={onEditMessage}
                onOpenInCanvas={onOpenInCanvas}
                onBranch={streaming ? undefined : onBranch}
                onStar={streaming ? undefined : onStar}
                onSpeak={onSpeak}
                speaking={speakingId === message.id}
                onReact={streaming ? undefined : onReact}
                onQuote={streaming ? undefined : onQuote}
                onRemember={streaming ? undefined : onRemember}
              />
            ))}
            <Suggestions
              last={messages[messages.length - 1]}
              streaming={streaming}
              onPick={(text) => {
                onInputChange(text);
                // After the box has the text, so the cursor lands after it.
                setTimeout(() => {
                  const box = document.getElementById("message-input") as HTMLTextAreaElement | null;
                  if (!box) return;
                  box.focus();
                  box.setSelectionRange(box.value.length, box.value.length);
                }, 0);
              }}
            />
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
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              });
            }}
            className="sticky bottom-4 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-raised text-ink-dim shadow-lg transition hover:text-ink"
            title="Jump to latest"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>

      <ChatInfo open={infoOpen} chat={chat} context={context} onClose={() => setInfoOpen(false)} />

      <ReplyAnnouncer streaming={streaming} />

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
        history={sent}
        meter={<ContextMeter info={context} />}
        prompts={prompts}
        onSlash={onSlash}
        temperature={temperature}
        onTemperature={onTemperature}
        replyLength={replyLength}
        onReplyLength={onReplyLength}
        disabled={!anyKey}
        placeholder={anyKey ? "Ask JARVIS anything…" : "Add an API key in Settings to start"}
      />
    </div>
  );
}

/**
 * Tells a screen reader when a reply starts and finishes — and nothing in
 * between. Hidden visually; present in the page.
 */
function ReplyAnnouncer({ streaming }: { streaming: boolean }) {
  const [text, setText] = useState("");
  const was = useRef(false);
  useEffect(() => {
    if (streaming && !was.current) setText("JARVIS is replying");
    else if (!streaming && was.current) setText("JARVIS has finished replying");
    was.current = streaming;
  }, [streaming]);
  return (
    <div role="status" aria-live="polite" className="sr-only" data-reply-status>
      {text}
    </div>
  );
}
