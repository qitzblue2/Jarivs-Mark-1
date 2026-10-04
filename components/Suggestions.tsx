"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { splitReasoning } from "@/lib/reasoning";
import { suggestFollowUps } from "@/lib/initiative/suggest";
import { useInitiative } from "@/lib/initiative/store";
import type { Message } from "@/lib/types";

interface Props {
  /** The newest message in the chat. */
  last: Message | undefined;
  streaming: boolean;
  /** Puts the words in the message box. Nothing is sent. */
  onPick: (text: string) => void;
}

/**
 * Next things you might ask, under the last reply. Buttons that fill the message
 * box — you read the words, change them if you like, and press Enter — so a
 * wrong guess costs a glance. Not shown while something is arriving, after a
 * message that called for quiet, or when the reply ended in a question of its
 * own: a row of buttons would be talking over it.
 */
export default function Suggestions({ last, streaming, onPick }: Props) {
  const s = useInitiative();
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);

  const chips = useMemo(() => {
    if (!last || last.role !== "assistant") return [];
    return suggestFollowUps(splitReasoning(last.content).answer, { error: Boolean(last.error) });
  }, [last]);

  if (streaming || !s.config.followUps || !last || hiddenFor === last.id) return null;
  if (s.distressUntil > Date.now()) return null;
  if (chips.length === 0) return null;

  return (
    <div className="px-4 pb-2 sm:px-6" data-suggestions>
      <div className="mx-auto flex max-w-[var(--chat-w)] items-center gap-2 pl-10 sm:pl-11">
        <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5" aria-label="Suggested follow-ups">
          {chips.map((chip) => (
            <li key={chip.id}>
              <button
                type="button"
                onClick={() => onPick(chip.text)}
                data-suggestion={chip.id}
                title={chip.text}
                className="rounded-full border border-line bg-panel px-3 py-1 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink"
              >
                {chip.label}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setHiddenFor(last.id)}
          aria-label="Hide suggestions"
          title="Hide these"
          className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink"
        >
          <X size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}
