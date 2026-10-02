"use client";

import { createPortal } from "react-dom";
import { Download, Monitor, X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
}

/** True for pictures this app made and serves, which can be downloaded and put on the wall. */
export function isOwnImage(src: string): boolean {
  return /^\/api\/images\/[0-9a-f-]{36}$/.test(src);
}

/** Send a picture to the room display. Same-origin only, which the server re-checks. */
export async function showOnDisplay(src: string, title?: string): Promise<string> {
  const res = await fetch("/api/display", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "show", content: { kind: "image", body: src, title } }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? "On the display." : data.error ?? "Couldn't reach the display.";
}

/**
 * A picture, full size, over everything. Escape or a click outside closes it.
 *
 * Portalled to <body> because markdown puts pictures inside a <p>, and a
 * <div> inside a <p> is invalid HTML React warns about on every render.
 */
export default function Lightbox({ src, alt, onClose }: Props) {
  useEscape(true, onClose);
  const dialogRef = useDialogFocus(true);

  const own = isOwnImage(src);

  return createPortal(
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Picture"}
    >
      <div className="absolute right-3 top-3 flex gap-1" onClick={(e) => e.stopPropagation()}>
        {own && (
          <>
            <a
              href={`${src}?download=1`}
              className="rounded-md p-2 text-ink-dim transition hover:bg-white/10 hover:text-ink"
              title="Download"
            >
              <Download size={18} />
            </a>
            <button
              onClick={() => void showOnDisplay(src, alt)}
              className="rounded-md p-2 text-ink-dim transition hover:bg-white/10 hover:text-ink"
              title="Show on the room display"
            >
              <Monitor size={18} />
            </button>
          </>
        )}
        <button
          onClick={onClose}
          className="rounded-md p-2 text-ink-dim transition hover:bg-white/10 hover:text-ink"
          title="Close"
        >
          <X size={18} />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        className="max-h-[88vh] max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      {alt && <p className="mt-3 max-w-2xl text-center text-sm text-ink-dim">{alt}</p>}
    </div>,
    document.body,
  );
}
