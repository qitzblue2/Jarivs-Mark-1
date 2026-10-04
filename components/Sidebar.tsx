"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowUpDown,
  Check,
  CheckSquare,
  ChevronRight,
  Square,
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
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { ChatMeta } from "@/lib/types";
import { parseQuery, passesFilters, type ChatHit } from "@/lib/chat-search";
import { groupByDate } from "@/lib/chat-groups";
import { relativeTime } from "@/lib/format";
import { tagCounts } from "@/lib/chat-ops";
import ChatMenu from "./ChatMenu";
import { COLOR_HEX, COLOR_NAME, type ChatColor } from "@/lib/chat-colors";
import { nextSort, SORT_LABEL, sortChatList } from "@/lib/chat-list";
import { setPrefs, usePrefs } from "@/lib/prefs-store";

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
  /** Archive, trash or tag several chats at once. */
  onBulk: (ids: string[], action: { type: "archive" } | { type: "trash" } | { type: "tag"; tag: string }) => void;
  /** Set a chat's colour label, or null to remove it. */
  onColor: (id: string, color: ChatColor | null) => void;
  onDuplicate: (id: string) => void;
  onEditInstructions: (id: string) => void;
  onOpenTrash: () => void;
  /** Messages you've starred, across every chat. */
  onOpenSaved: () => void;
  /** A backup zip chosen by the user, to be restored. */
  onRestoreFile: (file: File) => void;
  onOpenSettings: () => void;
  onOpenGallery: () => void;
  onOpenUsage: () => void;
  /** Present only when JARVIS may edit its own code. */
  onOpenSandbox?: () => void;
  storageDriver: string;
  /** Something that lives on the list's right edge — the resize handle — kept inside the landmark. */
  edge?: React.ReactNode;
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
  onBulk,
  onColor,
  onDuplicate,
  onEditInstructions,
  onOpenTrash,
  onOpenSaved,
  onRestoreFile,
  onOpenSettings,
  onOpenGallery,
  onOpenUsage,
  onOpenSandbox,
  storageDriver,
  edge,
}: Props) {
  const prefs = usePrefs();
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);
  /** Choosing several chats to act on together. */
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tagging, setTagging] = useState(false);
  const [tagDraft, setTagDraft] = useState("");

  function endSelecting() {
    setSelecting(false);
    setPicked(new Set());
    setTagging(false);
    setTagDraft("");
  }
  function toggle(id: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function bulk(action: Parameters<Props["onBulk"]>[1]) {
    if (picked.size === 0) return;
    onBulk([...picked], action);
    endSelecting();
  }

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
  const flat = useMemo(() => (prefs.chatSort === "recent" ? [] : sortChatList(live, prefs.chatSort)), [live, prefs.chatSort]);
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
              active && !selecting ? "bg-raised text-ink" : "text-ink-dim hover:bg-raised/60 hover:text-ink"
            }`}
          >
            {selecting && (
              <button
                type="button"
                role="checkbox"
                aria-checked={picked.has(chat.id)}
                aria-label={`Select ${chat.title}`}
                data-select-chat={chat.id}
                onClick={() => toggle(chat.id)}
                className="shrink-0 rounded p-0.5 text-ink-faint hover:text-arc"
              >
                {picked.has(chat.id) ? <CheckSquare size={15} className="text-arc" aria-hidden /> : <Square size={15} aria-hidden />}
              </button>
            )}
            <button
              onClick={() => (selecting ? toggle(chat.id) : onSelect(chat.id))}
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
                  {chat.color && (
                    <span role="img" aria-label={`${COLOR_NAME[chat.color]} label`} data-chat-color={chat.color} className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR_HEX[chat.color] }} />
                  )}
                  <span className="truncate">{chat.title}</span>
                  {chat.archived && <Archive size={10} className="shrink-0 text-ink-faint" aria-label="archived" />}
                </span>
                {chat.snippet ? (
                  <span className="line-clamp-2 block text-[11px] text-ink-dim">{chat.snippet}</span>
                ) : prefs.compactList ? null : (
                  <span className="block truncate text-[10px] text-ink-faint">
                    {relativeTime(chat.updatedAt)} · {chat.messageCount} msg
                    {chat.tags?.length ? ` · ${chat.tags.map((t) => `#${t}`).join(" ")}` : ""}
                  </span>
                )}
              </span>
            </button>

            {selecting ? null : confirmId === chat.id ? (
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
    <aside className="relative flex h-full w-full flex-col border-r border-line bg-panel" aria-label="Chats">
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

      <div className="flex gap-1.5 px-3 pb-2">
        <button
          onClick={onNew}
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm font-medium text-ink transition hover:border-arc-dim/50 hover:text-arc"
        >
          <Plus size={15} />
          New chat
        </button>
        <button
          type="button"
          onClick={() => setPrefs({ chatSort: nextSort(prefs.chatSort) })}
          title={`${SORT_LABEL[prefs.chatSort]} — press to change the order`}
          aria-label={`Chat order: ${SORT_LABEL[prefs.chatSort]}. Press to change.`}
          data-sort-button={prefs.chatSort}
          className={`shrink-0 rounded-lg border px-2.5 transition ${prefs.chatSort === "recent" ? "border-line bg-raised text-ink-faint hover:border-arc-dim/50 hover:text-arc" : "border-arc-dim bg-arc-dim/15 text-arc"}`}
        >
          <ArrowUpDown size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => (selecting ? endSelecting() : setSelecting(true))}
          aria-pressed={selecting}
          title={selecting ? "Stop selecting" : "Select several chats to archive, tag or trash together"}
          aria-label={selecting ? "Stop selecting chats" : "Select several chats"}
          data-select-mode
          className={`shrink-0 rounded-lg border px-2.5 transition ${selecting ? "border-arc-dim bg-arc-dim/15 text-arc" : "border-line bg-raised text-ink-faint hover:border-arc-dim/50 hover:text-arc"}`}
        >
          <CheckSquare size={15} aria-hidden />
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
                    on ? "bg-arc-solid text-white" : "bg-raised text-ink-dim hover:text-arc"
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
            {flat.length > 0 && (
              <section data-chat-section="sorted">
                <h2 className="px-2.5 pb-1 pt-1 text-[10px] font-normal uppercase tracking-widest text-ink-faint">{SORT_LABEL[prefs.chatSort]}</h2>
                <ul className="space-y-0.5">{flat.map(row)}</ul>
              </section>
            )}
            {flat.length === 0 && sections.map((section) => (
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

      {selecting && (
        <div className="space-y-2 border-t border-line-soft px-3 py-2" data-bulk-bar>
          <div className="flex items-center justify-between text-[11px] text-ink-dim" role="status" aria-live="polite">
            <span data-bulk-count>{picked.size === 0 ? "Pick the chats to act on" : `${picked.size} selected`}</span>
            <button type="button" onClick={() => setPicked(new Set((searching ? searchResults : live).map((c) => c.id)))} className="text-ink-faint underline-offset-2 hover:text-ink hover:underline">
              Select all shown
            </button>
          </div>
          {tagging ? (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (tagDraft.trim()) bulk({ type: "tag", tag: tagDraft });
              }}
            >
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                placeholder="tag"
                aria-label="Tag to add"
                autoFocus
                data-bulk-tag-input
                className="min-w-0 flex-1 rounded border border-line bg-base px-2 py-1 text-[12px] text-ink outline-none focus:border-arc-dim"
              />
              <button type="submit" className="rounded bg-arc-solid px-2.5 py-1 text-[12px] font-medium text-white hover:bg-arc-solid-hover">
                Add
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" disabled={picked.size === 0} onClick={() => bulk({ type: "archive" })} data-bulk="archive" className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[12px] text-ink-dim transition hover:text-ink disabled:opacity-40">
                <Archive size={12} aria-hidden /> Archive
              </button>
              <button type="button" disabled={picked.size === 0} onClick={() => setTagging(true)} data-bulk="tag" className="rounded border border-line px-2 py-1 text-[12px] text-ink-dim transition hover:text-ink disabled:opacity-40">
                Tag…
              </button>
              <button type="button" disabled={picked.size === 0} onClick={() => bulk({ type: "trash" })} data-bulk="trash" className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[12px] text-ink-dim transition hover:text-danger disabled:opacity-40">
                <Trash2 size={12} aria-hidden /> Trash
              </button>
              <button type="button" onClick={endSelecting} className="ml-auto rounded px-2 py-1 text-[12px] text-ink-faint transition hover:text-ink">
                Done
              </button>
            </div>
          )}
        </div>
      )}

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
                onClick={onOpenSaved}
                className="flex items-center gap-1 underline-offset-2 hover:text-arc hover:underline"
                title="Messages you've saved, from every chat"
              >
                <Star size={10} /> Saved
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
          onColor={(color) => onColor(menuChat.id, color)}
        />
      )}
      {edge}
    </aside>
  );
}
