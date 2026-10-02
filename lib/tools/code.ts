import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "./types";
import { requestApproval } from "./fs/approval";
import { checkSandbox, failureSummary } from "@/lib/sandbox/check";
import { diffLines, diffStats, unifiedDiff } from "@/lib/sandbox/diff";
import { resolveSource, sandboxPort, sandboxRoot, SandboxPathError, SOURCE_FILES } from "@/lib/sandbox/paths";
import { ensureSandbox, listChanges, readBoth, writeSandboxFile } from "@/lib/sandbox/sync";

/**
 * JARVIS reading and changing its own code.
 *
 * Every tool here works on the sandbox copy, never the running app. A change
 * goes live in the sandbox the moment it's written (it runs `next dev`), and
 * reaches the real JARVIS only when the user applies it from the Sandbox
 * panel — there is deliberately no tool for that.
 */

/** Tool results are clamped at 6,000 characters; a page stays under it. */
const PAGE_CHARS = 5200;

function explain(err: unknown): never {
  if (err instanceof SandboxPathError) throw new Error(err.message);
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") throw new Error("No such file in JARVIS' code. Use code_read with a folder to see what's there.");
  if (code === "EISDIR") throw new Error("That's a folder. Give a file path, or read the folder to list it.");
  throw err as Error;
}

async function overview(): Promise<string> {
  const lines = [
    "JARVIS' own source (a Next.js app). Folders:",
    "  app/        pages and API routes (app/api/*/route.ts)",
    "  components/ the interface (React)",
    "  lib/        everything else: providers, tools (lib/tools), voice, memory, storage",
    "  test/       unit and browser tests",
    "  scripts/    setup scripts",
    "  public/     static files",
    `Top-level files: ${SOURCE_FILES.join(", ")}`,
    "README.md describes how it all fits together.",
  ];
  const changes = await listChanges();
  if (changes.length) {
    lines.push("", `Changed in the sandbox, not yet applied (${changes.length}):`);
    for (const c of changes.slice(0, 30)) lines.push(`  ${c.status} ${c.path}`);
  }
  return lines.join("\n");
}

export const codeReadTool: Tool = {
  name: "code_read",
  description:
    "Read your own source code (as it is in your sandbox). A folder lists it; " +
    "a file returns numbered lines. No path gives an overview.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'e.g. "components/ChatPane.tsx" or "lib/tools".' },
      from: { type: "number", description: "First line to show, for long files." },
    },
  },

  async handler(args) {
    await ensureSandbox();
    const input = String(args.path ?? "").trim();
    if (!input || input === "." || input === "/") return overview();

    try {
      const { rel, abs } = await resolveSource(input, sandboxRoot());
      const stat = await fs.stat(abs);

      if (stat.isDirectory()) {
        const entries = (await fs.readdir(abs, { withFileTypes: true }))
          .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        const rows = await Promise.all(
          entries.slice(0, 200).map(async (e) =>
            e.isDirectory()
              ? `${e.name}/`
              : `${e.name} (${(await fs.stat(path.join(abs, e.name))).size} bytes)`,
          ),
        );
        return `${rel}/:\n${rows.join("\n") || "(empty)"}`;
      }

      const { sandbox, live } = await readBoth(rel);
      const text = sandbox ?? "";
      const all = text.split("\n");
      const start = Math.max(1, Math.floor(Number(args.from) || 1));
      const width = String(all.length).length;

      const out: string[] = [];
      let size = 0;
      let last = start - 1;
      for (let i = start - 1; i < all.length; i++) {
        const line = `${String(i + 1).padStart(width)}  ${all[i]}`;
        if (size + line.length > PAGE_CHARS && out.length > 0) break;
        out.push(line);
        size += line.length + 1;
        last = i + 1;
      }

      const state =
        live === null ? " (new in the sandbox)" : live !== sandbox ? " (changed in the sandbox, not yet applied)" : "";
      const more = last < all.length ? `\n…lines ${start}-${last} of ${all.length}. Continue with from=${last + 1}.` : "";
      return `${rel}${state}, ${all.length} lines:\n${out.join("\n")}${more}`;
    } catch (err) {
      explain(err);
    }
  },
};

export const codeEditTool: Tool = {
  name: "code_edit",
  description:
    "Change your own code, in your sandbox (never the running app). Either " +
    "find+replace (find must match exactly once) or content for a whole new " +
    "file. The user approves each edit and applies it to the real you.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      find: { type: "string", description: "Exact existing text, with enough lines to be unique." },
      replace: { type: "string" },
      content: { type: "string", description: "Whole file, instead of find/replace." },
    },
    required: ["path"],
  },

  async handler(args, ctx) {
    await ensureSandbox();
    let rel: string;
    try {
      ({ rel } = await resolveSource(String(args.path ?? ""), sandboxRoot(), { editable: true }));
    } catch (err) {
      explain(err);
    }

    const { sandbox: current } = await readBoth(rel);
    let next: string;

    if (typeof args.find === "string" && args.find.length > 0) {
      if (current === null) throw new Error(`${rel} doesn't exist. To create it, pass content instead of find.`);
      const find = args.find;
      const count = current.split(find).length - 1;
      if (count === 0) {
        throw new Error(
          `That text isn't in ${rel}. It must match exactly, spaces and indentation included — read the file again and copy it.`,
        );
      }
      if (count > 1) throw new Error(`That text appears ${count} times in ${rel}. Include more surrounding lines so it matches once.`);
      const at = current.indexOf(find);
      next = current.slice(0, at) + String(args.replace ?? "") + current.slice(at + find.length);
    } else if (typeof args.content === "string") {
      next = args.content;
    } else {
      throw new Error("Give find and replace to change part of a file, or content for the whole file.");
    }

    if (next === current) return `${rel} already reads that way; nothing changed.`;

    const diff = current === null ? next : unifiedDiff(current, next, rel);
    const decision = await requestApproval(
      {
        kind: "write",
        summary: current === null ? `Add ${rel} to JARVIS' code (sandbox)` : `Edit JARVIS' code: ${rel} (sandbox)`,
        detail: diff,
        path: rel,
      },
      ctx.onApprovalRequest ?? (() => {}),
    );
    if (decision === "deny") return `The user did not approve this change. ${rel} is unchanged.`;

    await writeSandboxFile(rel, next);
    const { added, removed } = diffStats(diffLines(current ?? "", next));
    return (
      `${current === null ? "Created" : "Edited"} ${rel} in the sandbox (+${added} −${removed}). ` +
      `It is running in the sandbox now (port ${sandboxPort()}); the real JARVIS is unchanged until the ` +
      "user applies it from the Sandbox panel. Run code_check before saying it works."
    );
  },
};

export const codeCheckTool: Tool = {
  name: "code_check",
  description: "Type-check and run the unit tests on your sandbox. Do this after editing.",
  parameters: { type: "object", properties: {} },

  async handler() {
    const result = await checkSandbox();
    const changes = await listChanges();
    const pending = changes.length
      ? `\n\n${changes.length} change${changes.length === 1 ? "" : "s"} waiting for the user to apply: ${changes.map((c) => c.path).join(", ")}`
      : "";
    return `${result.ok ? "All checks passed." : "Checks failed."}\n${failureSummary(result)}${pending}`;
  },
};
