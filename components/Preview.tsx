"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  /** A complete HTML document to run. */
  doc: string;
}

/**
 * Runs untrusted model-generated code.
 *
 * `sandbox="allow-scripts"` WITHOUT `allow-same-origin` is deliberate: the
 * iframe gets a unique opaque origin, so previewed code cannot read this app's
 * DOM, cookies, or localStorage, and cannot call our API routes as us.
 * Do not add `allow-same-origin` — combined with `allow-scripts` it lets the
 * frame remove its own sandbox.
 */
export default function Preview({ doc }: Props) {
  const [debounced, setDebounced] = useState(doc);
  const [nonce, setNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  // Debounce so typing in the editor doesn't re-run the page on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(doc), 400);
    return () => clearTimeout(timer);
  }, [doc]);

  return (
    <div className="relative flex h-full flex-col bg-white">
      <button
        onClick={() => setNonce((n) => n + 1)}
        className="absolute right-2 top-2 z-10 rounded bg-black/70 px-2 py-1 text-[11px] text-white/90 transition hover:bg-black"
        title="Re-run the preview"
      >
        Reload
      </button>
      <iframe
        ref={frame}
        key={nonce}
        title="Code preview"
        sandbox="allow-scripts allow-modals allow-forms allow-popups"
        srcDoc={debounced}
        className="h-full w-full border-0"
      />
    </div>
  );
}
