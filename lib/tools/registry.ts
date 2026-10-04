import { calculateTool } from "./calculate";
import { generateImageTool, resolveImageKey } from "./generate-image";
import { fetchUrlTool } from "./fetch-url";
import { forgetTool, recallTool, rememberTool } from "./remember";
import { listFilesTool, readFileTool, writeFileTool } from "./fs/files";
import { runCommandTool } from "./fs/exec";
import { computerAccessEnabled } from "./fs/workspace";
import { webSearchTool } from "./web-search";
import { clearDisplayTool, displayPowerTool, showOnDisplayTool } from "./display";
import { cancelScheduledTool, listScheduledTool, scheduleTaskTool } from "./schedule";
import { codeCheckTool, codeEditTool, codeReadTool } from "./code";
import { selfEditEnabled } from "@/lib/sandbox/paths";
import { displayConnected } from "@/lib/display";
import { deviceMode } from "@/lib/voice/device/detect";
import type { Tool, ToolContext } from "./types";

/** Every tool JARVIS can reach. Adding one is a file plus a line here. */
const ALL: Tool[] = [
  calculateTool,
  webSearchTool,
  fetchUrlTool,
  rememberTool,
  recallTool,
  forgetTool,
  {
    name: "get_time",
    description:
      "The current date and time. Use this rather than guessing; you have a " +
      "training cutoff and do not otherwise know today's date.",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: 'IANA name, e.g. "America/New_York". Default UTC.' },
      },
    },
    async handler(args) {
      const timeZone = String(args.timezone ?? "UTC");
      try {
        return new Date().toLocaleString("en-US", {
          timeZone,
          dateStyle: "full",
          timeStyle: "long",
        });
      } catch {
        throw new Error(`"${timeZone}" is not a valid IANA timezone.`);
      }
    },
  },
];

/**
 * Filesystem and command tools, behind an env-var gate.
 *
 * Gated by JARVIS_ALLOW_COMPUTER rather than a UI setting on purpose: a
 * setting could be flipped by anything with a session, and these tools are
 * the ones that can change the machine. When the gate is off they are not
 * registered at all — the model is never even told they exist.
 */
const COMPUTER: Tool[] = [listFilesTool, readFileTool, writeFileTool, runCommandTool];

/**
 * The room display.
 *
 * These three cost 287 tokens of schema on every single request, which is
 * real money on a tier metered per minute — so they are offered only where a
 * screen might actually exist: the appliance, or any install with a kiosk
 * page currently connected. Describing a projector to a laptop that has none
 * is a permanent tax for a capability that cannot be used.
 */
const DISPLAY: Tool[] = [showOnDisplayTool, clearDisplayTool, displayPowerTool];

/**
 * Scheduling, gated on the same test and for the same reason.
 *
 * These three cost 391 tokens — more than the display ones — and a scheduled
 * task is delivered by speaking it and putting it on the wall. Where neither
 * exists, a fired reminder writes a line to a JSON file nobody is watching,
 * which is not a reminder. So they are offered where an announcement can
 * actually land: the appliance, or an install with a kiosk page connected.
 *
 * Note this gates the TOOLS, not the feature. /api/schedule and the Scheduled
 * panel work everywhere, so a task can still be arranged by hand from a
 * laptop — you simply cannot ask for one out loud somewhere that could not
 * say it back.
 */
const SCHEDULE: Tool[] = [scheduleTaskTool, listScheduledTool, cancelScheduledTool];

/**
 * JARVIS editing its own code, behind its own env-var gate for the same
 * reason as the computer tools — and then only ever in the sandbox copy.
 * Applying a change to the running app is a button, never a tool.
 */
const SELF_EDIT: Tool[] = [codeReadTool, codeEditTool, codeCheckTool];

function displayAvailable(): boolean {
  return deviceMode() || displayConnected();
}

/**
 * Pictures, offered only when there is a NanoGPT key to make them with —
 * the server's or one from Settings. Without one the schema is a tax on every
 * request for a call that can only fail.
 */
function imagesAvailable(ctx: Pick<ToolContext, "imageKey">): boolean {
  return Boolean(ctx.imageKey ?? resolveImageKey());
}

export function allTools(ctx: Pick<ToolContext, "imageKey" | "disabledTools"> = {}): Tool[] {
  let tools = displayAvailable() ? [...ALL, ...DISPLAY, ...SCHEDULE] : ALL;
  if (imagesAvailable(ctx)) tools = [...tools, generateImageTool];
  if (selfEditEnabled()) tools = [...tools, ...SELF_EDIT];
  if (computerAccessEnabled()) tools = [...tools, ...COMPUTER];
  const off = ctx.disabledTools;
  return off && off.length > 0 ? tools.filter((t) => !off.includes(t.name)) : tools;
}

export function getTool(name: string, ctx: Pick<ToolContext, "imageKey" | "disabledTools"> = {}): Tool | undefined {
  return allTools(ctx).find((tool) => tool.name === name);
}
