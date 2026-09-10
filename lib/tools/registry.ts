import { calculateTool } from "./calculate";
import type { Tool } from "./types";

/** Every tool JARVIS can reach. Mark 2 phases add to this list. */
const ALL: Tool[] = [
  calculateTool,
  {
    name: "get_time",
    description:
      "Get the current date and time. Use this rather than guessing — your " +
      "training data has a cutoff and you do not otherwise know today's date.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: 'IANA timezone, e.g. "America/New_York". Defaults to UTC.',
        },
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

const BY_NAME = new Map(ALL.map((t) => [t.name, t]));

export function allTools(): Tool[] {
  return ALL;
}

export function getTool(name: string): Tool | undefined {
  return BY_NAME.get(name);
}
