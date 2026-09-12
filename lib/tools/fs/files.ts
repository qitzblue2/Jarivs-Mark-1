import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../types";
import { requestApproval } from "./approval";
import {
  ensureWorkspace,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  OutsideWorkspaceError,
  relative,
  resolveInWorkspace,
} from "./workspace";

/** Map containment failures to something the model can act on. */
function explain(err: unknown): never {
  if (err instanceof OutsideWorkspaceError) throw new Error(err.message);
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") throw new Error("No such file or directory in the workspace.");
  if (code === "EISDIR") throw new Error("That path is a directory, not a file.");
  if (code === "ENOTDIR") throw new Error("A parent of that path is not a directory.");
  if (code === "EACCES") throw new Error("Permission denied by the operating system.");
  throw err as Error;
}

export const listFilesTool: Tool = {
  name: "list_files",
  description:
    "List files and directories in the workspace. Use it to see what exists " +
    "before reading or writing. Paths are relative to the workspace root.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Directory to list. Defaults to the root (".").' },
    },
  },

  async handler(args) {
    await ensureWorkspace();
    try {
      const target = await resolveInWorkspace(String(args.path ?? "."));
      const entries = await fs.readdir(target, { withFileTypes: true });

      if (entries.length === 0) return `${relative(target)} is empty.`;

      const rows = await Promise.all(
        entries
          .filter((e) => !e.name.startsWith("."))
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
          .slice(0, 200)
          .map(async (entry) => {
            const full = path.join(target, entry.name);
            if (entry.isDirectory()) return `${entry.name}/`;
            try {
              const { size } = await fs.stat(full);
              return `${entry.name} (${size} bytes)`;
            } catch {
              return entry.name;
            }
          }),
      );

      return `${relative(target)}:\n${rows.join("\n")}`;
    } catch (err) {
      explain(err);
    }
  },
};

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read a text file from the workspace. Reading needs no approval; writing does.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to the workspace root." },
    },
    required: ["path"],
  },

  async handler(args) {
    await ensureWorkspace();
    try {
      const target = await resolveInWorkspace(String(args.path ?? ""));
      const { size } = await fs.stat(target);

      if (size > MAX_READ_BYTES) {
        throw new Error(
          `${relative(target)} is ${size} bytes, over the ${MAX_READ_BYTES} read limit.`,
        );
      }

      const text = await fs.readFile(target, "utf8");
      return `${relative(target)}:\n\n${text}`;
    } catch (err) {
      explain(err);
    }
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Create or overwrite a text file in the workspace. The user must approve " +
    "every write before it happens, and will see the content first.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to the workspace root." },
      content: { type: "string", description: "The complete new contents of the file." },
    },
    required: ["path", "content"],
  },

  async handler(args, ctx) {
    await ensureWorkspace();

    const content = String(args.content ?? "");
    if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
      throw new Error(`That content is over the ${MAX_WRITE_BYTES} byte write limit.`);
    }

    let target: string;
    try {
      target = await resolveInWorkspace(String(args.path ?? ""));
    } catch (err) {
      explain(err);
    }

    const existing = await fs.readFile(target, "utf8").catch(() => null);
    const rel = relative(target);

    const decision = await requestApproval(
      {
        kind: "write",
        summary: existing === null ? `Create ${rel}` : `Overwrite ${rel}`,
        detail: content,
        path: rel,
      },
      // The agent loop supplies this so the UI can render the card.
      ctx.onApprovalRequest ?? (() => {}),
    );

    if (decision === "deny") {
      return `The user did not approve writing ${rel}. The file is unchanged.`;
    }

    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      return `${existing === null ? "Created" : "Updated"} ${rel} (${Buffer.byteLength(content, "utf8")} bytes).`;
    } catch (err) {
      explain(err);
    }
  },
};
