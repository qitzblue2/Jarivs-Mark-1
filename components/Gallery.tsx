"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, ImageIcon, Monitor, Pencil, Trash2, X } from "lucide-react";
import { familyOf, lineageOf } from "@/lib/image-lineage";
import Lightbox, { showOnDisplay } from "./Lightbox";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";

interface Picture {
  id: string;
  url: string;
  prompt: string;
  model: string;
  createdAt: number;
  editedFrom?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Start a message asking for a change to this picture. The path goes in
   * the text so the model has it, rather than hoping it recalls one from
   * three chats ago.
   */
  onEdit?: (url: string) => void;
}

/** Every picture JARVIS has made, to look back at, download, or clear out. */
export default function Gallery({ open, onClose, onEdit }: Props) {
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [viewing, setViewing] = useState<Picture | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Set to look at one picture's family — the original and everything edited from it. */
  const [familyFor, setFamilyFor] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/images");
      const data = await res.json();
      if (data.error) setNote(data.error);
      else setPictures(data.images ?? []);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEscape(open && !viewing, onClose);

  async function remove(id: string) {
    const res = await fetch(`/api/images/${id}`, { method: "DELETE" });
    if (res.ok) {
      setPictures((all) => all.filter((p) => p.id !== id));
      if (familyFor === id) setFamilyFor(null);
    } else setNote("Couldn't delete that picture.");
  }

  async function copyPrompt(picture: Picture) {
    try {
      await navigator.clipboard.writeText(picture.prompt);
      setCopiedId(picture.id);
      setTimeout(() => setCopiedId((id) => (id === picture.id ? null : id)), 1500);
    } catch {
      setNote("Couldn't copy — the browser blocked the clipboard.");
    }
  }

  const focus = familyFor ? pictures.find((p) => p.id === familyFor) : undefined;
  // In a family, oldest first: the original, then each edit in the order it was made.
  const shown = focus ? familyOf(focus, pictures) : pictures;

  const dialogRef = useDialogFocus(open);
  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-xl border border-line bg-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Pictures"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ImageIcon size={16} className="text-arc" />
            Pictures
            <span className="text-[11px] font-normal text-ink-faint">{pictures.length}</span>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink" title="Close">
            <X size={16} />
          </button>
        </div>

        {note && (
          <p className="border-b border-line-soft px-4 py-2 text-[12px] text-warn">{note}</p>
        )}

        {focus && (
          <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2 text-[12px] text-ink-dim" data-family-banner>
            <span>
              {shown.length} {shown.length === 1 ? "picture" : "pictures"} from the same original, oldest first
            </span>
            <button onClick={() => setFamilyFor(null)} data-family-clear className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-dim hover:text-ink">
              Show all
            </button>
          </div>
        )}

        <div className="max-h-[70vh] overflow-y-auto p-4" tabIndex={0} role="region" aria-label="Picture list">
          {pictures.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-ink-faint">
              {loading
                ? "Loading…"
                : "No pictures yet. Ask JARVIS to draw something — it needs a NanoGPT key."}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {shown.map((picture) => {
                const lineage = lineageOf(picture, pictures);
                return (
                <li key={picture.id} data-picture={picture.id} className="group relative overflow-hidden rounded-lg border border-line bg-base">
                  <button onClick={() => setViewing(picture)} className="block w-full" title={picture.prompt}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={picture.url} alt={picture.prompt} loading="lazy" className="aspect-square w-full object-cover" />
                  </button>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-[11px] text-ink-dim" title={picture.prompt}>
                      {picture.editedFrom ? "✎ " : ""}
                      {picture.prompt}
                    </p>
                    <p className="text-[10px] text-ink-faint">
                      {new Date(picture.createdAt).toLocaleString()} · {picture.model}
                    </p>
                    {(picture.editedFrom || lineage.edits.length > 0) && (
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[10.5px]" data-lineage>
                        {picture.editedFrom &&
                          (lineage.original ? (
                            <button onClick={() => setFamilyFor(picture.id)} data-show-original className="inline-flex min-h-6 items-center rounded px-1 text-arc hover:underline">
                              Edited from an earlier picture
                            </button>
                          ) : (
                            <span className="text-ink-faint">Original deleted</span>
                          ))}
                        {lineage.edits.length > 0 && (
                          <button onClick={() => setFamilyFor(picture.id)} data-show-edits className="inline-flex min-h-6 items-center rounded px-1 text-arc hover:underline">
                            {lineage.edits.length} {lineage.edits.length === 1 ? "edit" : "edits"}
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                    <button
                      onClick={() => void copyPrompt(picture)}
                      data-copy-prompt
                      className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
                      title="Copy this picture's prompt"
                      aria-label="Copy this picture's prompt"
                    >
                      {copiedId === picture.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    {onEdit && (
                      <button
                        onClick={() => onEdit(picture.url)}
                        className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
                        title="Ask for a change to this picture"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                    <a
                      href={`${picture.url}?download=1`}
                      className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
                      title="Download"
                    >
                      <Download size={12} />
                    </a>
                    <button
                      onClick={async () => setNote(await showOnDisplay(picture.url, picture.prompt))}
                      className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
                      title="Show on the room display"
                    >
                      <Monitor size={12} />
                    </button>
                    <button
                      onClick={() => void remove(picture.id)}
                      className="rounded bg-black/60 p-1.5 text-white hover:bg-danger"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {viewing && <Lightbox src={viewing.url} alt={viewing.prompt} onClose={() => setViewing(null)} />}
    </div>
  );
}
