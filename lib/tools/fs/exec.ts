import { spawn } from "node:child_process";
import type { Tool } from "../types";
import { requestApproval } from "./approval";
import { ensureWorkspace, scrubbedEnv, workspaceRoot } from "./workspace";

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 30_000;

/**
 * Commands the model must never be able to run, even with approval.
 *
 * Not a security boundary on its own — approval and the scrubbed environment
 * are that. This is a guard against a careless click on something
 * catastrophic and irreversible.
 */
const REFUSED = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)*\/(\s|$)/i,  // rm -rf /
  /\bmkfs(\.|\s)/i,
  /\bdd\s+.*of=\/dev\//i,
  /:\(\)\s*\{.*\}\s*;?\s*:/,                   // fork bomb
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
  /\bchmod\s+(-[a-zA-Z]+\s+)*777\s+\//,
  />\s*\/dev\/[sh]d[a-z]/i,
];

export const runCommandTool: Tool = {
  name: "run_command",
  description:
    "Run a shell command inside the workspace directory. The user approves " +
    "every command before it runs and sees exactly what was requested. Use " +
    "it to build, test, install or inspect. API keys are removed from the " +
    "environment, so commands cannot read them.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command line to run." },
      reason: {
        type: "string",
        description: "One short line on why, shown to the user in the approval prompt.",
      },
    },
    required: ["command"],
  },

  async handler(args, ctx) {
    const command = String(args.command ?? "").trim();
    if (!command) throw new Error("No command given.");
    if (command.length > 2000) throw new Error("That command is implausibly long.");

    for (const pattern of REFUSED) {
      if (pattern.test(command)) {
        throw new Error(
          "That command is refused outright as destructive and irreversible. " +
            "Ask the user to run it themselves if they really want it.",
        );
      }
    }

    await ensureWorkspace();
    const reason = String(args.reason ?? "").trim();

    const decision = await requestApproval(
      {
        kind: "command",
        summary: command,
        detail: reason || undefined,
      },
      ctx.onApprovalRequest ?? (() => {}),
    );

    if (decision === "deny") {
      return `The user did not approve running: ${command}`;
    }

    return new Promise<string>((resolve) => {
      // shell:true is needed for pipes and redirection to work as the model
      // expects; the protection comes from approval plus the scrubbed env,
      // not from argument parsing.
      // Empty args array so TypeScript picks the (command, args, options)
      // overload; with shell:true the whole command line is passed through.
      const child = spawn(command, [], {
        cwd: workspaceRoot(),
        env: scrubbedEnv() as NodeJS.ProcessEnv,
        shell: true,
        signal: ctx.signal,
      });

      let out = "";
      let truncated = false;
      const append = (chunk: Buffer) => {
        if (out.length >= MAX_OUTPUT) {
          truncated = true;
          return;
        }
        out += chunk.toString("utf8");
      };

      child.stdout?.on("data", append);
      child.stderr?.on("data", append);

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        truncated = true;
        out += `\n[killed after ${TIMEOUT_MS / 1000}s]`;
      }, TIMEOUT_MS);

      const finish = (status: string) => {
        clearTimeout(timer);
        const body = out.slice(0, MAX_OUTPUT).trimEnd();
        resolve(
          `$ ${command}\n${status}\n\n${body || "(no output)"}` +
            (truncated ? "\n[output truncated]" : ""),
        );
      };

      child.on("error", (err) => finish(`failed to start: ${err.message}`));
      child.on("close", (code, signal) =>
        finish(signal ? `terminated by ${signal}` : `exit code ${code}`),
      );
    });
  },
};
