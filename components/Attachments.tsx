"use client";

import { FileText, Image as ImageIcon, X } from "lucide-react";
import { formatSize } from "@/lib/attachments";
import type { Attachment } from "@/lib/types";

interface Props {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
  compact?: boolean;
}

/** Attachment chips, used both in the composer and on sent messages. */
export default function Attachments({ attachments, onRemove, compact }: Props) {
  if (attachments.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "mb-2"}`}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group flex max-w-[220px] items-center gap-1.5 rounded-md border border-line bg-base px-2 py-1"
          title={attachment.note ?? attachment.name}
        >
          {attachment.kind === "image" && attachment.dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="h-6 w-6 shrink-0 rounded object-cover"
            />
          ) : attachment.kind === "image" ? (
            <ImageIcon size={12} className="shrink-0 text-arc" />
          ) : (
            <FileText size={12} className="shrink-0 text-ink-faint" />
          )}

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] text-ink-dim">{attachment.name}</span>
            <span className="block text-[9.5px] text-ink-faint">
              {attachment.note ? attachment.note.slice(0, 32) : formatSize(attachment.size)}
            </span>
          </span>

          {onRemove && (
            <button
              onClick={() => onRemove(attachment.id)}
              className="shrink-0 rounded p-0.5 text-ink-faint transition hover:text-danger"
              title="Remove"
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
