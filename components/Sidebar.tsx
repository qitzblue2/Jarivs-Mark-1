"use client";

import { useMemo, useState } from "react";
import { Check, MessageSquare, Plus, Search, Settings, Trash2, X } from "lucide-react";
import type { ChatMeta } from "@/lib/types";

interface Props {
  chats: ChatMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onOpenSettings: () => void;
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
  onOpenSettings,
  storageDriver,
}: Props) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats;
  }, [chats, query]);

  function commitRename(id: string) {
    const next = draft.trim();
    if (next) onRename(id, next);
    setRenamingId(null);
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2 px-3 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-arc-dim/15 text-[11px] font-bold text-arc ring-1 ring-arc-dim/30">
          J
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-wide">JARVIS</div>
          <div className="text-[10px] uppercase tracking-widest text-ink-faint">Mark 5</div>
        </div>
        <button
          onClick={onOpenSettings}
          className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink"
          title="Settings"
        >
          <Settings size={16} />
        </button>
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
            placeholder="Search chats"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-ink-faint hover:text-ink">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-ink-faint">
            {chats.length === 0 ? "No chats yet." : "Nothing matches that search."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((chat) => {
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
                      className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 transition ${
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
                        <MessageSquare
                          size={14}
                          className={`shrink-0 ${active ? "text-arc" : "text-ink-faint"}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px]">{chat.title}</span>
                          <span className="block text-[10px] text-ink-faint">
                            {relativeTime(chat.updatedAt)} · {chat.messageCount} msg
                          </span>
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
                            title="Confirm delete"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="rounded p-1 text-ink-faint hover:bg-line"
                            title="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmId(chat.id)}
                          className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition hover:bg-line hover:text-danger group-hover:opacity-100"
                          title="Delete chat"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="border-t border-line-soft px-3 py-2 text-[10px] text-ink-faint">
        {storageDriver === "fs" ? (
          <>Chats saved to <code className="font-mono">./data/chats</code></>
        ) : (
          <span className="text-warn">In-memory storage — chats vanish on restart</span>
        )}
      </div>
    </aside>
  );
}
