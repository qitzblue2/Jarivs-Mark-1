"use client";

import { usePrefs, setPrefs } from "@/lib/prefs-store";
import type { SendKey } from "@/lib/composing";
import { CHAT_SORTS, SORT_LABEL } from "@/lib/chat-list";
import type { ProviderState } from "./ModelPicker";

const SEND_KEYS: { id: SendKey; label: string; hint: string }[] = [
  { id: "enter", label: "Enter", hint: "Enter sends; Shift+Enter is a new line" },
  { id: "mod-enter", label: "Ctrl+Enter", hint: "Enter is a new line; Ctrl (or ⌘) + Enter sends" },
];

/**
 * How writing a message behaves. Applies at once, remembered on this device
 * only, and reachable from the keyboard like every other setting.
 */
export default function PrefsSettings({ providers }: { providers: ProviderState[] }) {
  const prefs = usePrefs();
  const choices = providers.filter((p) => p.ready).flatMap((p) => p.models.slice(0, 400).map((m) => ({ value: JSON.stringify({ provider: p.id, model: m }), label: `${m} — ${p.label}` })));
  const chosen = prefs.newChatModel ? JSON.stringify(prefs.newChatModel) : "";
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

      <div role="radiogroup" aria-label="New chats start with" data-choice="newChat" className="space-y-1 pt-1">
        <span className="block text-[11.5px] text-ink-dim">New chats start with</span>
        <div className="flex flex-wrap gap-1">
          {[
            { id: "last", label: "The model I used last" },
            { id: "fixed", label: "Always this one" },
          ].map((o) => {
            const on = (o.id === "fixed") === (prefs.newChatModel !== null);
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-value={o.id}
                onClick={() => setPrefs({ newChatModel: o.id === "last" ? null : (choices[0] ? JSON.parse(choices[0].value) : null) })}
                disabled={o.id === "fixed" && choices.length === 0}
                className={`rounded-md border px-2.5 py-1 text-[12px] transition disabled:opacity-50 ${on ? "border-arc-dim bg-arc-dim/15 text-ink" : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {prefs.newChatModel && (
          <select
            value={chosen}
            onChange={(e) => e.target.value && setPrefs({ newChatModel: JSON.parse(e.target.value) })}
            aria-label="The model new chats start with"
            data-new-chat-model
            className="w-full max-w-full rounded-md border border-line bg-base px-2 py-1 text-[12px] text-ink outline-none focus:border-arc-dim"
          >
            {!choices.some((c) => c.value === chosen) && <option value={chosen}>{prefs.newChatModel.model} (not available right now)</option>}
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <p className="text-[11.5px] text-ink-faint">Applies when you press New chat. Opening an old chat still uses the model it was last answered by.</p>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 py-0.5">
        <input type="checkbox" checked={prefs.reasoningOpen} onChange={(e) => setPrefs({ reasoningOpen: e.target.checked })} data-pref="reasoningOpen" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]" />
        <span className="text-[12.5px] text-ink">Show a thinking model&apos;s reasoning open, instead of folded away</span>
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 py-0.5">
        <input type="checkbox" checked={prefs.hideMeta} onChange={(e) => setPrefs({ hideMeta: e.target.checked })} data-pref="hideMeta" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]" />
        <span className="text-[12.5px] text-ink">
          Hide the model name, speed and reading time under replies
          <span className="block text-[11.5px] text-ink-faint">A fallback notice, a saved star and your ratings still show.</span>
        </span>
      </label>

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
