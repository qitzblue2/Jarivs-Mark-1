/**
 * What JARVIS can put on a wall.
 *
 * A closed union rather than free-form HTML, deliberately. The content is
 * model-authored and the display is a browser on a screen in your room, so
 * every variant here has to be renderable as inert data. Adding a variant is
 * a decision about what a model may cause to appear, which is the right thing
 * to have to think about.
 */
export type DisplayContent =
  | { kind: "text"; body: string; title?: string }
  | { kind: "markdown"; body: string; title?: string }
  | { kind: "code"; body: string; language?: string; title?: string }
  | { kind: "image"; src: string; alt?: string; title?: string };

/** How the display is laid out, independent of what is on it. */
export type DisplayView = "normal" | "large" | "fullscreen";

export interface DisplayStatus {
  /** Browsers currently subscribed. Zero means nothing will be seen. */
  connected: number;
  content: DisplayContent | null;
  view: DisplayView;
  /** When the current content was pushed. */
  since: number | null;
  power: PowerStatus;
}

export interface PowerStatus {
  /** Whether a way to control the screen was found at all. */
  available: boolean;
  /** Which mechanism answered: cec, wlr-randr, vcgencmd. */
  method: string | null;
  /** Last known state, if we have ever been told one. */
  on: boolean | null;
  problem?: string;
}

/**
 * One screen JARVIS can drive.
 *
 * An interface rather than a concrete HDMI implementation so a smart TV, a
 * Chromecast or a second Pi later are the same thing to everything upstream —
 * the tools, the voice loop and the UI should never learn how the pixels get
 * there.
 */
export interface Display {
  show(content: DisplayContent): Promise<void>;
  clear(): Promise<void>;
  setView(view: DisplayView): Promise<void>;
  power(on: boolean): Promise<PowerStatus>;
  status(): Promise<DisplayStatus>;
}

/** Events the kiosk page receives over SSE. */
export type DisplayEvent =
  | { type: "content"; content: DisplayContent | null; view: DisplayView }
  | { type: "view"; view: DisplayView }
  /** Keeps the connection from being reaped, and proves it is still alive. */
  | { type: "ping"; at: number };
