"use client";

import { useEffect, useRef } from "react";

/**
 * Close a modal on Escape — reliably, and without the page behind it also
 * reacting.
 *
 * Two traps, both hit for real (see VoiceMode.tsx for the first write-up):
 *
 *   Workspace listens for Escape on window too, to close the code canvas. Its
 *   handler runs first and React re-renders synchronously; a modal whose
 *   `onClose` is an inline arrow would re-subscribe on that render, and the
 *   DOM drops a listener removed mid-dispatch. So this subscribes once per
 *   open and reads `onClose` from a ref.
 *
 *   A modal should win. Capture phase plus stopPropagation means Escape closes
 *   the topmost thing and nothing else — not the dialog and the canvas too.
 */
export function useEscape(active: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);
}
