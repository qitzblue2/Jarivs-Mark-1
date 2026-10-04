"use client";

import { usePrefs, setPrefs } from "@/lib/prefs-store";
import type { SendKey } from "@/lib/composing";
import { CHAT_SORTS, SORT_LABEL } from "@/lib/chat-list";

const SEND_KEYS: { id: SendKey; label: string; hint: string }[] = [
  { id: "enter", label: "Enter", hint: "Enter sends; Shift+Enter is a new line" },
  { id: "mod-enter", label: "Ctrl+Enter", hint: "Enter is a new line; Ctrl (or ⌘) + Enter sends" },
];

/**
 * How writing a message behaves. Applies at once, remembered on this device
 * only, and reachable from the keyboard like every other setting.
 */
export default function PrefsSettings() {
  const prefs = usePrefs();
  return (
    <section className="space-y-2.5" data-prefs-settings>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">Writing and the chat list</h3>

      <div role="radiogroup" aria-label="Send with" data-choice="sendKey" className="space-y-1">
        <span className="block text-[11.5px] text-ink-dim">Send with</span>
        <div className="flex flex-wrap gap-1">
          {SEND_KEYS.map((k) => {
            const on = prefs.sendKey === k.id;
            return (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-value={k.id}
                onClick={() => setPrefs({ sendKey: k.id })}
                className={`rounded-md border px-2.5 py-1 text-[12px] transition ${on ? "border-arc-dim bg-arc-dim/15 text-ink" : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"}`}
              >
                {k.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11.5px] text-ink-faint">{SEND_KEYS.find((k) => k.id === prefs.sendKey)?.hint}</p>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 py-0.5">
        <input
          type="checkbox"
          checked={prefs.spellcheck}
          onChange={(e) => setPrefs({ spellcheck: e.target.checked })}
          data-pref="spellcheck"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]"
        />
        <span className="text-[12.5px] text-ink">Underline misspelled words in the message box</span>
      </label>

      <div role="radiogroup" aria-label="Chat list order" data-choice="chatSort" className="space-y-1 pt-1">
        <span className="block text-[11.5px] text-ink-dim">Chat list order</span>
        <div className="flex flex-wrap gap-1">
          {CHAT_SORTS.map((id) => {
            const on = prefs.chatSort === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                data-value={id}
                onClick={() => setPrefs({ chatSort: id })}
                className={`rounded-md border px-2.5 py-1 text-[12px] transition ${on ? "border-arc-dim bg-arc-dim/15 text-ink" : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"}`}
              >
                {SORT_LABEL[id]}
              </button>
            );
          })}
        </div>
        <p className="text-[11.5px] text-ink-faint">Recent groups chats by day; the others are one flat list. Pinned chats stay on top. The arrows button above the list cycles through these.</p>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 py-0.5">
        <input
          type="checkbox"
          checked={prefs.compactList}
          onChange={(e) => setPrefs({ compactList: e.target.checked })}
          data-pref="compactList"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]"
        />
        <span className="text-[12.5px] text-ink">Compact chat list — titles only, without the time and message count</span>
      </label>
    </section>
  );
}
