"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  ChevronRight,
  FlaskConical,
  Gauge,
  ImageIcon,
  MessageSquare,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { ChatMeta } from "@/lib/types";
import { parseQuery, passesFilters, type ChatHit } from "@/lib/chat-search";
import { groupByDate } from "@/lib/chat-groups";
import { tagCounts } from "@/lib/chat-ops";
import ChatMenu from "./ChatMenu";

interface Props {
  chats: ChatMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Moves to the trash; nothing is destroyed. */
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onArchive: (id: string, archived: boolean) => void;
  onTags: (id: string, tags: string[]) => void;
  onDuplicate: (id: string) => void;
  onEditInstructions: (id: string) => void;
  onOpenTrash: () => void;
  /** A backup zip chosen by the user, to be restored. */
  onRestoreFile: (file: File) => void;
  onOpenSettings: () => void;
  onOpenGallery: () => void;
  onOpenUsage: () => void;
  /** Present only when JARVIS may edit its own code. */
  onOpenSandbox?: () => void;
  storageDriver: string;
}

function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function Sidebar({
  chats,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  onArchive,
  onTags,
  onDuplicate,
  onEditInstructions,
  onOpenTrash,
  onRestoreFile,
  onOpenSettings,
  onOpenGallery,
  onOpenUsage,
  onOpenSandbox,
  storageDriver,
}: Props) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);

  /**
   * Titles filter instantly as you type; the server's search of what was
   * actually said lands a moment later and replaces them. Results for a query
   * you have since changed are thrown away, so a slow reply can't overwrite a
   * newer one.
   */
  const [hits, setHits] = useState<{ query: string; chats: ChatHit[] } | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chats?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = await res.json();
        if (Array.isArray(data.chats)) setHits({ query: q, chats: data.chats });
      } catch {
        /* aborted, or offline — the title filter still stands */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  // While searching, the same rules as the server: words in the title, plus
  // tag:/is: filters, so what shows instantly is what will still be there.
  const searching = q.length > 0;
  const searchResults: ChatHit[] = useMemo(() => {
    if (!searching) return [];
    if (hits?.query === q) return hits.chats;
    const parsed = parseQuery(q);
    return chats
      .filter((c) => passesFilters(c, parsed))
      .filter((c) => parsed.words.every((w) => c.title.toLowerCase().includes(w)));
  }, [chats, q, hits, searching]);

  const live = useMemo(() => chats.filter((c) => !c.archived), [chats]);
  const archived = useMemo(() => chats.filter((c) => c.archived), [chats]);
  const sections = useMemo(() => groupByDate(live), [live]);
  const tags = useMemo(() => tagCounts(live), [live]);

  function commitRename(id: string) {
    const next = draft.trim();
    if (next) onRename(id, next);
    setRenamingId(null);
  }

  function row(chat: ChatHit) {
    const active = chat.id === activeId;
    return (
      <li key={chat.id}>
        {renamingId === chat.id ? (
          <div className="flex items-center gap-1 px-1.5 py-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(chat.id);
                if (e.key === "Escape") setRenamingId(null);
              }}
              onBlur={() => commitRename(chat.id)}
              autoFocus
              className="w-full rounded border border-arc-dim bg-base px-2 py-1 text-[13px] outline-none"
            />
          </div>
        ) : (
          <div
            data-chat-row={chat.id}
            className={`group flex items-center gap-1 rounded-lg px-2.5 py-2 transition ${
              active ? "bg-raised text-ink" : "text-ink-dim hover:bg-raised/60 hover:text-ink"
            }`}
          >
            <button
              onClick={() => onSelect(chat.id)}
              onDoubleClick={() => {
                setDraft(chat.title);
                setRenamingId(chat.id);
              }}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title={`${chat.title} — double-click to rename`}
            >
              <MessageSquare size={14} className={`shrink-0 ${active ? "text-arc" : "text-ink-faint"}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate text-[13px]">
                  <span className="truncate">{chat.title}</span>
                  {chat.archived && <Archive size={10} className="shrink-0 text-ink-faint" aria-label="archived" />}
                </span>
                {chat.snippet ? (
                  <span className="line-clamp-2 block text-[11px] text-ink-dim">{chat.snippet}</span>
                ) : (
                  <span className="block truncate text-[10px] text-ink-faint">
                    {relativeTime(chat.updatedAt)} · {chat.messageCount} msg
                    {chat.tags?.length ? ` · ${chat.tags.map((t) => `#${t}`).join(" ")}` : ""}
                  </span>
                )}
              </span>
            </button>

            {confirmId === chat.id ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={() => {
                    onDelete(chat.id);
                    setConfirmId(null);
                  }}
                  className="rounded p-1 text-danger hover:bg-danger/15"
                  title="Move to trash"
                >
                  <Check size={13} />
                </button>
                <button onClick={() => setConfirmId(null)} className="rounded p-1 text-ink-faint hover:bg-line" title="Cancel">
                  <X size={13} />
                </button>
              </span>
            ) : (
              <>
                <button
                  onClick={() => onTogglePin(chat.id, !chat.pinned)}
                  className={`shrink-0 rounded p-1 transition hover:bg-line hover:text-arc ${
                    chat.pinned ? "text-arc" : "text-ink-faint opacity-0 focus:opacity-100 group-hover:opacity-100"
                  }`}
                  title={chat.pinned ? "Unpin" : "Pin to top"}
                >
                  {chat.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
                <button
                  onClick={(e) => setMenu({ id: chat.id, anchor: e.currentTarget.getBoundingClientRect() })}
                  className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition hover:bg-line hover:text-ink focus:opacity-100 group-hover:opacity-100"
                  title="More"
                  aria-haspopup="menu"
                >
                  <MoreHorizontal size={13} />
                </button>
                <button
                  onClick={() => setConfirmId(chat.id)}
                  className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition hover:bg-line hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  title="Move to trash"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        )}
      </li>
    );
  }

  const menuChat = menu ? chats.find((c) => c.id === menu.id) : undefined;

  return (
    <aside className="flex h-full w-full flex-col border-r border-line bg-panel" aria-label="Chats">
      <div className="flex items-center gap-2 px-3 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-arc-dim/15 text-[11px] font-bold text-arc ring-1 ring-arc-dim/30">
          J
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-wide">JARVIS</div>
          <div className="text-[10px] uppercase tracking-widest text-ink-faint">Mark 6</div>
        </div>
        {/* Grouped without gaps so four buttons leave room for the name. */}
        <div className="flex shrink-0 items-center">
          {onOpenSandbox && (
            <button
              onClick={onOpenSandbox}
              className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-arc"
              title="Sandbox — JARVIS' code, and a copy to test it in"
            >
              <FlaskConical size={16} />
            </button>
          )}
          <button
            onClick={onOpenUsage}
            className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink"
            title="Usage"
          >
            <Gauge size={16} />
          </button>
          <button
            onClick={onOpenGallery}
            className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink"
            title="Pictures"
          >
            <ImageIcon size={16} />
          </button>
          <button
            onClick={onOpenSettings}
            className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink"
            title="Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm font-medium text-ink transition hover:border-arc-dim/50 hover:text-arc"
        >
          <Plus size={15} />
          New chat
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-base px-2.5 py-1.5">
          <Search size={13} className="shrink-0 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats (Ctrl+/)"
            aria-label="Search chats"
            data-chat-search
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-ink-faint hover:text-ink" title="Clear search">
              <X size={13} />
            </button>
          )}
        </div>
        {tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1" data-tag-filter>
            {tags.slice(0, 12).map(({ tag, count }) => {
              const on = q === `tag:${tag}`;
              return (
                <button
                  key={tag}
                  onClick={() => setQuery(on ? "" : `tag:${tag}`)}
                  title={on ? "Clear the filter" : `Show only chats tagged ${tag}`}
                  aria-pressed={on}
                  className={`rounded-full px-2 py-0.5 text-[10.5px] transition ${
                    on ? "bg-arc-dim text-white" : "bg-raised text-ink-dim hover:text-arc"
                  }`}
                >
                  #{tag} <span className="opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Chat list">
        {searching ? (
          searchResults.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-ink-faint">Nothing matches that search.</p>
          ) : (
            <ul className="space-y-0.5">{searchResults.map(row)}</ul>
          )
        ) : (
          <>
            {live.length === 0 && archived.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-ink-faint">No chats yet.</p>
            )}
            {sections.map((section) => (
              <section key={section.label} data-chat-section={section.label}>
                <h2 className="px-2.5 pb-1 pt-3 text-[10px] font-normal uppercase tracking-widest text-ink-faint first:pt-1">
                  {section.label}
                </h2>
                <ul className="space-y-0.5">{section.chats.map(row)}</ul>
              </section>
            ))}
            {archived.length > 0 && (
              <section className="mt-3 border-t border-line-soft pt-2">
                <button
                  onClick={() => setShowArchived((v) => !v)}
                  aria-expanded={showArchived}
                  className="flex w-full items-center gap-1.5 px-2.5 py-1 text-[11px] text-ink-faint transition hover:text-ink"
                >
                  <ChevronRight size={12} className={`transition ${showArchived ? "rotate-90" : ""}`} />
                  <Archive size={12} /> Archived ({archived.length})
                </button>
                {showArchived && <ul className="mt-1 space-y-0.5" data-archived-list>{archived.map(row)}</ul>}
              </section>
            )}
          </>
        )}
      </nav>

      <div className="space-y-1 border-t border-line-soft px-3 py-2 text-[10px] text-ink-faint">
        {storageDriver === "fs" ? (
          <>
            <div>
              Chats saved to <code className="font-mono">./data/chats</code>
            </div>
            <div className="flex items-center gap-3 text-ink-dim">
              <a
                href="/api/backup"
                className="underline-offset-2 hover:text-arc hover:underline"
                title="Download every chat, memory and picture as one zip"
              >
                Back up
              </a>
              <button
                onClick={() => restoreInput.current?.click()}
                className="underline-offset-2 hover:text-arc hover:underline"
                title="Add what's missing from a backup zip. Nothing existing is overwritten."
              >
                Restore
              </button>
              <button
                onClick={onOpenTrash}
                className="flex items-center gap-1 underline-offset-2 hover:text-arc hover:underline"
                title="Deleted chats, kept for 30 days"
              >
                <Trash2 size={10} /> Trash
              </button>
              <input
                ref={restoreInput}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                data-restore-file
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onRestoreFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          </>
        ) : (
          <span className="text-warn">In-memory storage — chats vanish on restart</span>
        )}
      </div>

      {menu && menuChat && (
        <ChatMenu
          chat={menuChat}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onTags={(next) => onTags(menuChat.id, next)}
          onArchive={(archivedNow) => onArchive(menuChat.id, archivedNow)}
          onDuplicate={() => onDuplicate(menuChat.id)}
          onInstructions={() => onEditInstructions(menuChat.id)}
        />
      )}
    </aside>
  );
}
