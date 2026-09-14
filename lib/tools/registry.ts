import { calculateTool } from "./calculate";
import { fetchUrlTool } from "./fetch-url";
import { forgetTool, recallTool, rememberTool } from "./remember";
import { listFilesTool, readFileTool, writeFileTool } from "./fs/files";
import { runCommandTool } from "./fs/exec";
import { computerAccessEnabled } from "./fs/workspace";
import { webSearchTool } from "./web-search";
import type { Tool } from "./types";

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

export function allTools(): Tool[] {
  return computerAccessEnabled() ? [...ALL, ...COMPUTER] : ALL;
}

export function getTool(name: string): Tool | undefined {
  return allTools().find((tool) => tool.name === name);
}
