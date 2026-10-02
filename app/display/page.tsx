"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "@/components/Markdown";
import type { DisplayContent, DisplayEvent, DisplayView } from "@/lib/display/types";

/**
 * The screen on the wall.
 *
 * Deliberately not the app: no header, no sidebar, no controls. Nobody
 * interacts with this page — it is looked at from across a room, usually by a
 * projector, so everything is large, high contrast, and still.
 *
 * Launch it on the Pi with:
 *   chromium --kiosk http://localhost:3000/display
 */
export default function DisplayPage() {
  const [content, setContent] = useState<DisplayContent | null>(null);
  const [view, setView] = useState<DisplayView>("normal");
  const [live, setLive] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    /**
     * Reconnect with backoff rather than needing someone to walk over and
     * restart a browser. A dev server reload, a WiFi blip or a Pi resuming
     * from sleep all sever this, and a display that never comes back is
     * indistinguishable from one that was never working.
     */
    function connect() {
      if (stopped) return;
      source = new EventSource("/api/display/stream");

      source.onopen = () => {
        retry.current = 0;
        setLive(true);
      };

      source.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as DisplayEvent;
          if (event.type === "content") {
            setContent(event.content);
            setView(event.view);
          } else if (event.type === "view") {
            setView(event.view);
          }
          // A ping carries nothing; receiving it is the whole point.
          setLive(true);
        } catch {
          /* a malformed frame is not worth tearing the display down for */
        }
      };

      source.onerror = () => {
        setLive(false);
        source?.close();
        retry.current = Math.min(retry.current + 1, 6);
        timer = setTimeout(connect, 500 * 2 ** (retry.current - 1));
      };
    }

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, []);

  const scale =
    view === "fullscreen" ? "text-[2.4vw]" : view === "large" ? "text-[1.8vw]" : "text-[1.25vw]";

  return (
    <div className="fixed inset-0 flex flex-col bg-base text-ink">
      {content?.title && (
        <h1 className="shrink-0 px-[4vw] pt-[3vh] text-[2vw] font-semibold tracking-tight text-ink">
          {content.title}
        </h1>
      )}

      <div className={`min-h-0 flex-1 overflow-hidden px-[4vw] py-[3vh] ${scale}`}>
        {!content ? (
          <Idle />
        ) : content.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={content.src}
            alt={content.alt ?? ""}
            className="h-full w-full object-contain"
          />
        ) : content.kind === "code" ? (
          <pre className="h-full overflow-hidden whitespace-pre-wrap break-words font-mono leading-relaxed text-ink">
            {content.body}
          </pre>
        ) : content.kind === "text" ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{content.body}</p>
        ) : (
          // Markdown escapes HTML rather than rendering it. On a screen in a
          // room showing model-authored content, that is the difference
          // between text and script execution.
          <div className="display-markdown leading-relaxed">
            <Markdown content={content.body} />
          </div>
        )}
      </div>

      {/* Small enough to ignore, present enough to explain a frozen screen. */}
      {!live && (
        <div className="absolute bottom-[2vh] right-[2vw] text-[0.9vw] text-ink-faint">
          reconnecting…
        </div>
      )}
    </div>
  );
}

/**
 * What a powered projector shows when there is nothing to say.
 *
 * A clock, rather than black: a black rectangle is indistinguishable from a
 * broken display, and someone will go and check the cable.
 */
function Idle() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Set on the client only; rendering a time on the server guarantees a
    // hydration mismatch the moment the second ticks over.
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return null;

  return (
    <div className="flex h-full flex-col items-center justify-center text-ink-faint">
      <div className="font-mono text-[9vw] leading-none tracking-tight">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="mt-[2vh] text-[1.4vw]">
        {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
      </div>
    </div>
  );
}
