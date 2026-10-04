/**
 * Slash commands in the composer.
 *
 * Typing "/" lists them. A command runs only when the whole message is exactly
 * a known command (optionally followed by words); anything else beginning with
 * a slash — "/usr/bin/env is missing" — goes to the model like any other
 * message. A shortcut that can swallow a real message is worse than none.
 *
 * Two kinds. An *action* does something and the message is not sent. A *text*
 * command (and every saved prompt) puts words into the composer for you to
 * edit and send — nothing is ever sent on your behalf.
 */
export interface SlashCommand {
  name: string;
  summary: string;
  kind: "action" | "text";
  /** For text commands: what goes into the composer. */
  text?: string;
  /** Needs words after it ("/model fast"): choosing it from the menu fills the box instead of running it. */
  takesArgs?: boolean;
}

export const COMMANDS: SlashCommand[] = [
  { name: "new", summary: "Start a new chat", kind: "action" },
  { name: "pin", summary: "Pin or unpin this chat", kind: "action" },
  { name: "archive", summary: "Archive this chat", kind: "action" },
  { name: "export", summary: "Download this chat as Markdown", kind: "action" },
  { name: "instructions", summary: "Edit this chat's own instructions", kind: "action" },
  { name: "theme", summary: "Switch between system, dark and light", kind: "action" },
  { name: "model", summary: "Switch model — /model fast", kind: "action", takesArgs: true },
  { name: "title", summary: "Rename this chat — /title New name", kind: "action", takesArgs: true },
  { name: "tag", summary: "Add or remove tags — /tag work -old", kind: "action", takesArgs: true },
  { name: "undo", summary: "Take back your last message and its reply", kind: "action" },
  { name: "help", summary: "Show keyboard shortcuts", kind: "action" },
  {
    name: "summarize",
    summary: "Ask for a summary of this chat",
    kind: "text",
    text: "Summarize our conversation so far in five bullet points, then list anything still unresolved.",
  },
];

export const COMMAND_NAMES = COMMANDS.map((c) => c.name);

export interface SlashMatch {
  name: string;
  summary: string;
  kind: "action" | "text" | "prompt";
  text?: string;
  takesArgs?: boolean;
  /** Whatever followed the command: `/review focus on security` → "focus on security". */
  args: string;
}

/** Everything that completes what has been typed after the slash, commands first. */
export function matchSlash(input: string, prompts: { name: string; text: string }[] = []): SlashMatch[] {
  // Only while still typing the name: once there is a space, the command is chosen.
  const m = /^\/([a-z0-9-]*)$/.exec(input);
  if (!m) return [];
  const typed = m[1];
  const commands: SlashMatch[] = COMMANDS.filter((c) => c.name.startsWith(typed)).map((c) => ({ ...c, args: "" }));
  const saved: SlashMatch[] = prompts
    .filter((p) => p.name.startsWith(typed))
    .map((p) => ({ name: p.name, summary: p.text.replace(/\s+/g, " ").slice(0, 60), kind: "prompt", text: p.text, args: "" }));
  return [...commands, ...saved];
}

/**
 * The command a finished message is, if it is one: `/new`, `/summarize`, or a
 * saved prompt's name. Null means send it as an ordinary message.
 */
export function parseSlash(input: string, prompts: { name: string; text: string }[] = []): SlashMatch | null {
  const m = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!m) return null;
  const args = (m[2] ?? "").trim();
  const command = COMMANDS.find((c) => c.name === m[1]);
  if (command) return { ...command, args };
  const prompt = prompts.find((p) => p.name === m[1]);
  return prompt ? { name: prompt.name, summary: "", kind: "prompt", text: prompt.text, args } : null;
}
