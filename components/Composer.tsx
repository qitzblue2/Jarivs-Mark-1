"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ListChecks, Paperclip, Square } from "lucide-react";
import Attachments from "./Attachments";
import { fileToAttachment } from "@/lib/attach-client";
import { PromptHistory } from "@/lib/history";
import { matchSlash, type SlashMatch } from "@/lib/slash";
import type { SavedPrompt } from "@/lib/prompts";
import type { Attachment } from "@/lib/types";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /**
   * `task` asks for a task run: more tool rounds, and the goal pinned so a
   * long run cannot forget it. Always explicit — escalating on the model's
   * behalf would spend quota and write files nobody agreed to.
   */
  onSend: (task?: boolean) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  attachments: Attachment[];
  onAttach: (attachments: Attachment[]) => void;
  onRemoveAttachment: (id: string) => void;
  onAttachError: (message: string) => void;
  /** What you've sent in this chat, oldest first, for the up arrow. */
  history: string[];
  /** Saved prompts, offered alongside the built-in commands after a "/". */
  prompts: SavedPrompt[];
  /** A command or prompt was chosen from the slash menu. */
  onSlash: (match: SlashMatch) => void;
}

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  attachments,
  onAttach,
  onRemoveAttachment,
  onAttachError,
  history,
  prompts,
  onSlash,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);

  // --- the slash menu ---
  const [highlight, setHighlight] = useState(0);
  // Escape closes the menu for what is typed now; typing more reopens it.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const matches = useMemo(() => matchSlash(value, prompts), [value, prompts]);
  const menuOpen = matches.length > 0 && dismissedFor !== value;
  useEffect(() => setHighlight(0), [value]);

  // --- up-arrow history ---
  const recall = useRef(new PromptHistory(history));
  useEffect(() => {
    recall.current.sync(history);
  }, [history]);

  const caretToEnd = () =>
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });

  function choose(match: SlashMatch) {
    setDismissedFor(null);
    onSlash({ ...match, args: "" });
  }

  const ingest = useCallback(
    async (files: FileList | File[]) => {
      const list = [...files];
      if (list.length === 0) return;
      setReading(true);
      const accepted: Attachment[] = [];
      for (const file of list) {
        try {
          accepted.push(await fileToAttachment(file));
        } catch (err) {
          onAttachError((err as Error).message);
        }
      }
      setReading(false);
      if (accepted.length > 0) onAttach(accepted);
    },
    [onAttach, onAttachError],
  );

  // Grow with the content, up to a ceiling, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;

    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + step + matches.length) % matches.length);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        choose(matches[Math.min(highlight, matches.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedFor(value);
        return;
      }
    }

    // Up/Down walk back through what you've sent — but only from an empty box
    // or one already showing a recalled message, and only from its first/last
    // line, so the arrows never steal the cursor from text you're editing.
    const el = e.currentTarget;
    const onFirstLine = !value.slice(0, el.selectionStart).includes("\n");
    const onLastLine = !value.slice(el.selectionEnd).includes("\n");
    if (e.key === "ArrowUp" && onFirstLine && (value === "" || recall.current.browsing)) {
      const older = recall.current.up(value);
      if (older !== null) {
        e.preventDefault();
        onChange(older);
        caretToEnd();
      }
      return;
    }
    if (e.key === "ArrowDown" && onLastLine && recall.current.browsing) {
      const newer = recall.current.down();
      if (newer !== null) {
        e.preventDefault();
        onChange(newer);
        caretToEnd();
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) onSend(false);
    }
  }

  /** Screenshot straight from the clipboard is the common case here. */
  function onPaste(e: React.ClipboardEvent) {
    const files = [...e.clipboardData.files];
    if (files.length > 0) {
      e.preventDefault();
      void ingest(files);
    }
  }

  return (
    <div
      className="border-t border-line bg-base/95 px-3 py-3 backdrop-blur sm:px-6 sm:py-4"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void ingest(e.dataTransfer.files);
      }}
    >
      <div className="relative mx-auto max-w-3xl">
        {menuOpen && (
          <ul
            id="slash-menu"
            role="listbox"
            data-slash-menu
            className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-60 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-2xl"
          >
            {matches.map((m, i) => (
              <li
                key={`${m.kind}-${m.name}`}
                role="option"
                aria-selected={i === highlight}
                // mousedown, not click: click fires after the textarea has lost focus and the menu is gone.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex cursor-pointer items-baseline gap-3 rounded-md px-3 py-1.5 text-[13px] ${
                  i === highlight ? "bg-raised text-ink" : "text-ink-dim"
                }`}
              >
                <span className="font-mono text-arc">/{m.name}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">{m.summary}</span>
                {m.kind === "prompt" && <span className="text-[10px] uppercase tracking-wider text-ink-faint">prompt</span>}
              </li>
            ))}
          </ul>
        )}
        <Attachments attachments={attachments} onRemove={onRemoveAttachment} />

        <div
          className={`flex items-end gap-2 rounded-xl border bg-raised p-2 transition focus-within:border-arc-dim/60 ${
            dragging ? "border-arc bg-arc-dim/10" : "border-line"
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,.pdf,text/*,.md,.json,.yaml,.yml,.csv,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.c,.cpp,.cs,.sh,.sql,.html,.css"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void ingest(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={disabled || reading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line hover:text-ink disabled:opacity-40"
            title="Attach an image, PDF or text file"
          >
            <Paperclip size={15} className={reading ? "animate-pulse text-arc" : ""} />
          </button>
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => {
              // Typing ends any browsing: what's here is yours now.
              recall.current.reset();
              onChange(e.target.value);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={menuOpen}
            aria-controls="slash-menu"
            aria-autocomplete="list"
            aria-label="Message"
            onPaste={onPaste}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? "Ask JARVIS anything…"}
            className="max-h-[220px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          {/* Beside Send rather than hidden in Settings: it changes what the
              turn costs and what it may touch, so it should be a visible
              choice made per message. */}
          {!streaming && (
            <button
              onClick={() => onSend(true)}
              disabled={disabled || !value.trim()}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-arc-dim/50 px-2.5 text-[12px] text-arc transition hover:bg-arc-dim/10 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint"
              title="Work on this — lets JARVIS take many steps instead of one answer"
            >
              <ListChecks size={14} />
              Work on this
            </button>
          )}
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
              onClick={() => onSend(false)}
              disabled={disabled || !value.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-arc-dim text-white transition hover:bg-arc disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-faint"
              title="Send (Enter)"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-[11px] text-ink-faint">
          {dragging
            ? "Drop to attach"
            : "Enter to send · Shift+Enter for a new line · / for commands · ↑ for your last message"}
        </div>
      </div>
    </div>
  );
}
