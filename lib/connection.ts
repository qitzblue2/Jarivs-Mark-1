/**
 * Whether JARVIS can currently reach its own server — the state machine behind
 * the banner at the top of the window.
 *
 * Two different ways to be cut off, and they read differently: the browser
 * itself is offline (`navigator.onLine`, which flips instantly), or the
 * browser is online but the server isn't answering — it restarted, crashed, or
 * you left the network it lives on. The second is the more common one for
 * something self-hosted, and `onLine` can't see it, so a small request to
 * /api/health does.
 *
 * Two failed checks in a row are needed before the banner shows, so one
 * dropped packet doesn't flash it.
 */
export type Link = "ok" | "browser-offline" | "server-unreachable";

export interface ConnectionState {
  browserOnline: boolean;
  /** Consecutive failed health checks. */
  failures: number;
}

export type ConnectionEvent = "online" | "offline" | "check-ok" | "check-failed";

export const FAILURES_BEFORE_BANNER = 2;

export function linkOf(state: ConnectionState): Link {
  if (!state.browserOnline) return "browser-offline";
  return state.failures >= FAILURES_BEFORE_BANNER ? "server-unreachable" : "ok";
}

export function reduceConnection(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  switch (event) {
    case "online":
      return { ...state, browserOnline: true };
    case "offline":
      return { ...state, browserOnline: false };
    case "check-ok":
      return { ...state, failures: 0 };
    case "check-failed":
      return { ...state, failures: state.failures + 1 };
  }
}

/** Milliseconds until the next health check. Quick while something looks wrong. */
export function nextCheckDelay(state: ConnectionState): number {
  if (linkOf(state) !== "ok") return 5_000;
  return state.failures > 0 ? 2_000 : 20_000;
}

/** Any answer at all means the server is there; only silence or a gateway error means it isn't. */
export function reachable(status: number): boolean {
  return status < 500;
}

export const BANNER_TEXT: Record<Exclude<Link, "ok">, string> = {
  "browser-offline": "You're offline. Messages can't be sent until your connection is back.",
  "server-unreachable": "Can't reach the JARVIS server — it may have restarted. Trying again…",
};
