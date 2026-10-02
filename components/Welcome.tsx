"use client";

import { useEffect, useState } from "react";
import { AudioLines, ImageIcon, Keyboard, MessageSquare, Search, Star } from "lucide-react";
import { relativeTime } from "@/lib/format";
import { timeGreeting } from "@/lib/welcome";
import type { ChatMeta } from "@/lib/types";

export type QuickActionId = "search" | "voice" | "pictures" | "saved" | "shortcuts";

const ACTIONS: { id: QuickActionId; label: string; hint?: string; icon: typeof Search }[] = [
  { id: "search", label: "Search chats", hint: "Ctrl+/", icon: Search },
  { id: "voice", label: "Voice mode", hint: "Ctrl+J", icon: AudioLines },
  { id: "pictures", label: "Pictures", icon: ImageIcon },
  { id: "saved", label: "Saved messages", icon: Star },
  { id: "shortcuts", label: "Keyboard shortcuts", hint: "?", icon: Keyboard },
];

interface Props {
  starters: string[];
  onPick: (starter: string) => void;
  recent: ChatMeta[];
  onOpenChat: (id: string) => void;
  onAction: (id: QuickActionId) => void;
}

/**
 * What an empty chat offers once there is somewhere to answer: a greeting for
 * the hour, a way back into the last few conversations, things to try, and the
 * parts of JARVIS that are otherwise a button you have to know about.
 */
export default function Welcome({ starters, onPick, recent, onOpenChat, onAction }: Props) {
  // After mount: the server's clock and time zone aren't yours, and a greeting
  // rendered there would be wrong for you and mismatch on hydration.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => setGreeting(timeGreeting(new Date())), []);

  return (
    <div className="space-y-5 text-left" data-welcome>
      <p className="h-4 text-center text-[12px] text-ink-faint" data-greeting>
        {greeting}
      </p>

      {recent.length > 0 && (
        <section aria-labelledby="welcome-recent" data-welcome-recent>
          <h3 id="welcome-recent" className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
            Pick up where you left off
          </h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {recent.map((chat) => (
              <li key={chat.id}>
                <button
                  type="button"
                  onClick={() => onOpenChat(chat.id)}
                  data-recent-chat={chat.id}
                  className="flex w-full items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-left transition hover:border-arc-dim/40"
                >
                  <MessageSquare size={13} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] text-ink">{chat.title}</span>
                    <span className="block text-[11px] text-ink-faint">
                      {relativeTime(chat.updatedAt)} · {chat.messageCount} msg
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="welcome-try">
        <h3 id="welcome-try" className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
          Try
        </h3>
        <div className="grid gap-1.5">
          {starters.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => onPick(starter)}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-left text-[12.5px] text-ink-dim transition hover:border-arc-dim/40 hover:text-ink"
            >
              {starter}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="welcome-do" data-welcome-actions>
        <h3 id="welcome-do" className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
          Quick actions
        </h3>
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {ACTIONS.map(({ id, label, hint, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onAction(id)}
                data-quick-action={id}
                className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-[12px] text-ink-dim transition hover:border-arc-dim/40 hover:text-ink"
              >
                <Icon size={13} className="shrink-0 text-arc" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {hint && <kbd className="shrink-0 rounded border border-line-strong bg-raised px-1 font-mono text-[10px] text-ink-faint">{hint}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
