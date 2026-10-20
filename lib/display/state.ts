import type { DisplayContent, DisplayEvent, DisplayView } from "./types";

/**
 * What is on the wall, and who is showing it.
 *
 * A module singleton, like `lib/voice/device/runtime.ts`: there is one room,
 * so there is one display state, and two would mean two screens disagreeing.
 *
 * The current content is kept rather than only broadcast. A kiosk browser
 * that reconnects — after a reboot, a hot reload, a dropped WiFi frame —
 * would otherwise sit blank until the next command, which on a wall looks
 * exactly like the feature being broken.
 */

type Subscriber = (event: DisplayEvent) => void;

const subscribers = new Set<Subscriber>();

let content: DisplayContent | null = null;
let view: DisplayView = "normal";
let since: number | null = null;

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  // Catch the newcomer up immediately; see above.
  fn({ type: "content", content, view });
  return () => {
    subscribers.delete(fn);
  };
}

function broadcast(event: DisplayEvent): void {
  for (const fn of [...subscribers]) {
    try {
      fn(event);
    } catch {
      // A display that throws on write has gone; its own close handler will
      // remove it. One bad subscriber must not stop the others updating.
    }
  }
}

export function connectedCount(): number {
  return subscribers.size;
}

export function setContent(next: DisplayContent | null): void {
  content = next;
  since = next ? Date.now() : null;
  broadcast({ type: "content", content, view });
}

export function setView(next: DisplayView): void {
  view = next;
  broadcast({ type: "view", view });
}

export function currentContent(): DisplayContent | null {
  return content;
}

export function currentView(): DisplayView {
  return view;
}

export function contentSince(): number | null {
  return since;
}

/** Heartbeat, so a half-open connection is noticed rather than assumed live. */
export function ping(): void {
  broadcast({ type: "ping", at: Date.now() });
}

/** Tests only — the app has exactly one room and never resets it. */
export function resetDisplayState(): void {
  subscribers.clear();
  content = null;
  view = "normal";
  since = null;
}
