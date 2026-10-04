"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, Copy, Download, FileJson, SlidersHorizontal, Tag, X } from "lucide-react";
import { normalizeTag, MAX_TAGS } from "@/lib/chat-ops";
import { CHAT_COLORS, COLOR_HEX, COLOR_NAME, type ChatColor } from "@/lib/chat-colors";
import { useEscape } from "@/lib/hooks/use-escape";
import type { ChatMeta } from "@/lib/types";

interface Props {
  chat: ChatMeta;
  /** The button that opened it, so the menu can sit beside it. */
  anchor: DOMRect;
  onClose: () => void;
  onTags: (tags: string[]) => void;
  onArchive: (archived: boolean) => void;
  onDuplicate: () => void;
  onInstructions: () => void;
  /** Set the colour label, or null to take it off. */
  onColor: (color: ChatColor | null) => void;
}

const WIDTH = 220;

/**
 * The "…" menu on a chat row.
 *
 * Drawn in a portal at fixed coordinates: the chat list scrolls, and a menu
 * positioned inside it would be clipped by the list's edge, or scroll away
 * from the row it belongs to.
 */
export default function ChatMenu({ chat, anchor, onClose, onTags, onArchive, onDuplicate, onInstructions, onColor }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [tags, setTags] = useState<string[]>(chat.tags ?? []);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<ChatColor | null>(chat.color ?? null);
  const [pos, setPos] = useState({ left: Math.max(8, anchor.right - WIDTH), top: anchor.bottom + 4 });

  useEscape(true, onClose);

  // Opens downward, unless that would run off the bottom of the window.
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    const fitsBelow = anchor.bottom + 4 + h <= window.innerHeight - 8;
    setPos({
      left: Math.min(Math.max(8, anchor.right - WIDTH), window.innerWidth - WIDTH - 8),
      top: fitsBelow ? anchor.bottom + 4 : Math.max(8, anchor.top - 4 - h),
    });
  }, [anchor]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  function commit(next: string[]) {
    setTags(next);
    onTags(next);
  }

  function addDraft() {
    // Commas separate, so "work, home" is two tags.
    const added = draft.split(",").map(normalizeTag).filter((t): t is string => t !== null);
    setDraft("");
    if (added.length === 0) return;
    commit([...new Set([...tags, ...added])].slice(0, MAX_TAGS));
  }

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-ink-dim transition hover:bg-raised hover:text-ink";

  return createPortal(
    <div
      ref={box}
      // A dialog holding the tag box and colours, with the actions as a real menu inside it:
      // a menu may only hold menu items, and a text field is not one.
      role="dialog"
      aria-label={`Options for ${chat.title}`}
      data-chat-menu
      className="fixed z-[70] rounded-lg border border-line bg-panel p-1 shadow-2xl"
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
    >
      <div className="px-2 pb-1.5 pt-1">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-ink-faint">
          <Tag size={11} /> Tags
        </div>
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-full bg-arc-dim/15 px-2 py-0.5 text-[11px] text-arc">
              {t}
              <button onClick={() => commit(tags.filter((x) => x !== t))} title={`Remove ${t}`} className="hover:text-white">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
            // Escape belongs to the menu, not the field.
          }}
          onBlur={addDraft}
          disabled={tags.length >= MAX_TAGS}
          placeholder={tags.length >= MAX_TAGS ? "That's the most tags" : "Add a tag, press Enter"}
          aria-label="Add a tag"
          className="mt-1.5 w-full rounded border border-line-soft bg-base px-2 py-1 text-[12px] outline-none placeholder:text-ink-faint focus:border-arc-dim"
        />
      </div>

      <div className="px-2 pb-1.5">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-ink-faint">Colour label</div>
        <div className="flex items-center gap-1.5" data-color-choices role="radiogroup" aria-label="Colour label">
          {CHAT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={COLOR_NAME[c]}
              title={color === c ? `${COLOR_NAME[c]} — press to remove` : COLOR_NAME[c]}
              data-color={c}
              onClick={() => {
                const next = color === c ? null : c;
                setColor(next);
                onColor(next);
              }}
              className={`h-5 w-5 rounded-full ring-offset-2 ring-offset-panel transition ${color === c ? "ring-2 ring-ink" : "hover:ring-2 hover:ring-line-strong"}`}
              style={{ background: COLOR_HEX[c] }}
            />
          ))}
        </div>
      </div>

      <div className="my-1 border-t border-line-soft" />

      <div role="menu" aria-label="Chat actions">
      <button
        role="menuitem"
        className={item}
        onClick={() => {
          onInstructions();
          onClose();
        }}
      >
        <SlidersHorizontal size={13} /> Chat instructions…
      </button>
      <button
        role="menuitem"
        className={item}
        onClick={() => {
          onDuplicate();
          onClose();
        }}
      >
        <Copy size={13} /> Duplicate
      </button>
      <button
        role="menuitem"
        className={item}
        onClick={() => {
          onArchive(!chat.archived);
          onClose();
        }}
      >
        {chat.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
        {chat.archived ? "Unarchive" : "Archive"}
      </button>
      <a role="menuitem" className={item} href={`/api/chats/${chat.id}/export`} onClick={onClose}>
        <Download size={13} /> Export as Markdown
      </a>
      <a role="menuitem" className={item} href={`/api/chats/${chat.id}/export?format=json`} onClick={onClose}>
        <FileJson size={13} /> Export as JSON
      </a>
      </div>
    </div>,
    document.body,
  );
}
