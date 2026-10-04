"use client";

import { useEffect, useReducer, useRef } from "react";
import { WifiOff } from "lucide-react";
import {
  BANNER_TEXT,
  linkOf,
  nextCheckDelay,
  reachable,
  reduceConnection,
  type ConnectionEvent,
  type ConnectionState,
} from "@/lib/connection";

/**
 * A strip across the top when the browser is offline or the server has gone
 * quiet. The region is always in the page and only its contents change, which
 * is what lets a screen reader announce the change.
 */
export default function ConnectionBanner() {
  const [state, dispatch] = useReducer(reduceConnection, { browserOnline: true, failures: 0 } as ConnectionState);
  const latest = useRef(state);
  latest.current = state;

  // The browser's own idea of the connection.
  useEffect(() => {
    if (!navigator.onLine) dispatch("offline");
    const up = () => dispatch("online");
    const down = () => dispatch("offline");
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // The server's: a small request now and then, and straight away whenever you
  // come back to the tab or the network returns.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // One check at a time: a second one started by a focus event while the
    // first is in flight would each schedule a next one, and the loops would double.
    let busy = false;
    // The delay to the next check depends on the result of this one, which React
    // hasn't rendered yet — so the ref is advanced by hand, with the same reducer.
    const apply = (event: ConnectionEvent) => {
      latest.current = reduceConnection(latest.current, event);
      dispatch(event);
    };

    async function check() {
      if (stopped || busy) return;
      busy = true;
      clearTimeout(timer);
      try {
        if (document.visibilityState === "visible" && navigator.onLine) {
          try {
            const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(5000) });
            apply(reachable(res.status) ? "check-ok" : "check-failed");
          } catch {
            apply("check-failed");
          }
        }
      } finally {
        busy = false;
        if (!stopped) timer = setTimeout(check, nextCheckDelay(latest.current));
      }
    }

    const soon = () => void check();
    window.addEventListener("focus", soon);
    window.addEventListener("online", soon);
    document.addEventListener("visibilitychange", soon);
    timer = setTimeout(check, nextCheckDelay(latest.current));
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", soon);
      window.removeEventListener("online", soon);
      document.removeEventListener("visibilitychange", soon);
    };
  }, []);

  const link = linkOf(state);

  return (
    <div role="status" aria-live="polite" data-connection-status={link}>
      {link !== "ok" && (
        <div
          data-connection-banner
          className="flex items-center gap-2 border-b border-warn/40 bg-warn/15 px-3 py-1.5 text-[11.5px] text-warn"
        >
          <WifiOff size={13} className="shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{BANNER_TEXT[link]}</span>
        </div>
      )}
    </div>
  );
}
