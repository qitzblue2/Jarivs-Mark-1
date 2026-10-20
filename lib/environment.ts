import path from "node:path";
import { computerAccessEnabled, workspaceRoot } from "@/lib/tools/fs/workspace";
import { sandboxRoot, selfEditEnabled } from "@/lib/sandbox/paths";

/**
 * What the model is told about where it is running.
 *
 * Without this a model given file and shell tools guesses: it lists "." and
 * doesn't know what it's looking at, runs Unix commands on Windows, uses the
 * workspace file tools on its own code, and goes hunting for .env files it can
 * never read — burning every tool step of the turn on it. A few lines, sent
 * only when those tools are switched on.
 */
export function environmentNote(): string {
  const lines: string[] = [];

  if (computerAccessEnabled()) {
    const rel = path.relative(process.cwd(), workspaceRoot()) || ".";
    const sandboxDir = path.dirname(sandboxRoot());
    const inSandbox = workspaceRoot() === sandboxDir || workspaceRoot().startsWith(sandboxDir + path.sep);
    lines.push(
      `list_files, read_file, write_file and run_command work only inside the folder "${rel}" — ` +
        (inSandbox
          ? "which is set to your sandbox; for your own code use the code_ tools instead."
          : "a scratch folder for the user's files, not your own code."),
    );
    lines.push(
      process.platform === "win32"
        ? "This machine runs Windows: run_command uses cmd.exe, so write Windows commands (dir, type, findstr)."
        : `This machine runs ${process.platform === "darwin" ? "macOS" : "Linux"}: run_command uses sh.`,
    );
  }
  if (selfEditEnabled()) {
    lines.push(
      "Your own source code is reached with code_read, code_edit and code_check — start with code_read and no path. " +
        "Edits land in your sandbox; the user applies them to the real you.",
    );
  }
  if (lines.length === 0) return "";

  lines.push(
    "You can never read .env files or API keys, by design. Don't look for them; tell the user keys belong in .env.local or Settings.",
  );
  return `\n\nYour environment:\n- ${lines.join("\n- ")}`;
}
