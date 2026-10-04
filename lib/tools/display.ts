import { display, displayConnected } from "@/lib/display";
import type { DisplayContent } from "@/lib/display";
import type { Tool } from "./types";

/**
 * Putting things on the wall.
 *
 * Two containment rules run through all three tools, both because this is the
 * first thing JARVIS does that is visible from across a room:
 *
 *   Nothing model-supplied reaches a process. `display_power` takes a
 *   boolean choice and the command is built from that, never from a string.
 *
 *   Nothing model-supplied is fetched by the display. An image must already
 *   be on this origin or be a data: URI, because the kiosk browser does not
 *   run `lib/tools/net-guard.ts` and an arbitrary URL on your wall is a
 *   worse version of the problem that guard exists to prevent.
 */

/** Same-origin paths and inline data only — see above. */
function safeImage(src: string): string | null {
  const value = src.trim();
  if (!value) return null;
  if (value.startsWith("data:image/")) return value;
  // A root-relative path is served by this app and nothing else.
  if (/^\/[^/\\]/.test(value)) return value;
  return null;
}

export const showOnDisplayTool: Tool = {
  name: "show_on_display",
  description:
    "Put something on the room's screen. Use it when the answer is easier to " +
    "read than to hear — code, a list, a long explanation — especially when " +
    "the user is talking to you rather than typing.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["text", "markdown", "code", "image"],
        description: "Default markdown.",
      },
      body: { type: "string", description: "The content, or the image path." },
      title: { type: "string", description: "Optional heading." },
      language: { type: "string", description: "For code, e.g. python." },
    },
    required: ["body"],
  },

  async handler(args) {
    const body = String(args.body ?? "").trim();
    if (!body) throw new Error("Nothing to show.");

    const kind = String(args.kind ?? "markdown");
    const title = args.title ? String(args.title) : undefined;

    let content: DisplayContent;
    if (kind === "image") {
      const src = safeImage(body);
      if (!src) {
        throw new Error(
          "Images must be a path on this server or a data: URI. A link to " +
            "somewhere else can't be shown on the room display.",
        );
      }
      content = { kind: "image", src, alt: title, title };
    } else if (kind === "code") {
      content = { kind: "code", body, language: args.language ? String(args.language) : undefined, title };
    } else if (kind === "text") {
      content = { kind: "text", body, title };
    } else {
      content = { kind: "markdown", body, title };
    }

    await display.show(content);

    // Saying "done" when no screen is connected would be a lie the model
    // then repeats to the user.
    return displayConnected()
      ? `Shown on the display${title ? `: ${title}` : "."}`
      : "Queued, but no display is connected — it will appear when one is.";
  },
};

export const clearDisplayTool: Tool = {
  name: "clear_display",
  description: "Clear the room's screen. Use it when what's up is no longer relevant.",
  parameters: { type: "object", properties: {} },

  async handler() {
    await display.clear();
    return "Display cleared.";
  },
};

export const displayPowerTool: Tool = {
  name: "display_power",
  description:
    "Turn the room's screen or projector on or off. Turn it off when you're " +
    "done with it — a projector left on wastes its lamp.",
  parameters: {
    type: "object",
    properties: {
      on: { type: "boolean", description: "True for on, false for off." },
    },
    required: ["on"],
  },

  async handler(args) {
    // A boolean, so nothing the model wrote can reach the command built from
    // it. This is the whole reason this tool is not behind the approval gate.
    const on = args.on === true || args.on === "true";
    const result = await display.power(on);

    if (!result.available) return result.problem ?? "No screen control available.";
    if (result.problem) return `Tried to turn it ${on ? "on" : "off"}, but: ${result.problem}`;
    return `Screen turned ${on ? "on" : "off"} via ${result.method}.`;
  },
};
