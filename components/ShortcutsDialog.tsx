"use client";

import { X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";
import { SHORTCUT_GROUPS, isMac, keyLabel } from "@/lib/shortcuts";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Every keyboard shortcut, opened with "?" or /help. */
export default function ShortcutsDialog({ open, onClose }: Props) {
  useEscape(open, onClose);
  const ref = useDialogFocus(open);
  if (!open) return null;

  const mac = isMac(typeof navigator === "undefined" ? "" : navigator.platform);

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        data-shortcuts
        className="w-full max-w-md rounded-xl border border-line bg-panel shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="shortcuts-title" className="text-sm font-semibold">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div tabIndex={0} role="region" aria-label="Shortcuts" className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-dim">{group.title}</h3>
              <dl className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.action} className="flex items-start justify-between gap-4 text-[13px]">
                    <dt className="text-ink-dim">{item.action}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-6 rounded border border-line-strong bg-raised px-1.5 py-0.5 text-center font-mono text-[11.5px] text-ink"
                        >
                          {keyLabel(k, mac)}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
