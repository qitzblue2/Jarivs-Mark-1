"use client";

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";

interface Status {
  provider: "nanogpt" | "free" | "none";
  model: string;
  note: string;
}

/**
 * Which service draws your pictures, in words, and a way into the studio. The
 * status comes from the server so it is true: it knows about the environment
 * key and the on/off switch for the free service, which the page cannot see.
 */
export default function ImageSettings({ nanoKey, onOpenStudio }: { nanoKey?: string; onOpenStudio?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/images/generate", { headers: nanoKey ? { "x-jarvis-keys": JSON.stringify({ nanogpt: nanoKey }) } : {} })
      .then((r) => r.json())
      .then((d) => !cancelled && setStatus(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [nanoKey]);

  return (
    <section className="space-y-2.5" data-image-settings>
      <div>
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
          <ImageIcon size={12} aria-hidden />
          Pictures
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
          JARVIS can draw like any picture generator: open the studio, type <code className="font-mono">/image a fox in snow</code>, or press the Draw button that
          appears when a message asks for a picture. Pictures are saved to your gallery.
        </p>
      </div>
      <p className="rounded-md border border-line-soft bg-base px-3 py-2 text-[12px] text-ink-dim" data-image-status>
        {failed
          ? "Couldn't reach the server to check."
          : !status
            ? "Checking…"
            : status.provider === "none"
              ? status.note
              : `${status.provider === "free" ? "Free, no key." : "NanoGPT."} ${status.note}`}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-[11.5px] leading-relaxed text-ink-faint">
        <li>
          <b className="font-medium text-ink-dim">Free:</b> works with no key and no account, through a public service. It draws new pictures only.
        </li>
        <li>
          <b className="font-medium text-ink-dim">NanoGPT:</b> add a key (API keys, above) for better models and for editing a picture you attach. It is used first when present.
        </li>
        <li>
          <b className="font-medium text-ink-dim">Let the model draw too:</b> set <code className="font-mono">JARVIS_FREE_IMAGES=1</code> so a chat can call the picture tool without
          a key. Off by default because the tool adds to every request.
        </li>
        <li>
          <b className="font-medium text-ink-dim">Switch the free service off:</b> <code className="font-mono">JARVIS_FREE_IMAGES=0</code> if prompts must not leave your machine.
        </li>
      </ul>
      {onOpenStudio && (
        <button type="button" onClick={onOpenStudio} data-open-studio className="min-h-8 rounded-md border border-line px-3 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink">
          Open the image studio
        </button>
      )}
    </section>
  );
}
