"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import Attachments from "./Attachments";
import { fileToAttachment } from "@/lib/attach-client";
import type { Attachment } from "@/lib/types";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  attachments: Attachment[];
  onAttach: (attachments: Attachment[]) => void;
  onRemoveAttachment: (id: string) => void;
  onAttachError: (message: string) => void;
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
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);

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
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!streaming) onSend();
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
      <div className="mx-auto max-w-3xl">
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
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
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
          {dragging
            ? "Drop to attach"
            : "Enter to send · Shift+Enter for a new line · drag, paste or clip a file"}
        </div>
      </div>
    </div>
  );
}
