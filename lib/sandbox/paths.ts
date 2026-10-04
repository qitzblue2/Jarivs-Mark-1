import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Where JARVIS' own code lives, where its sandbox copy lives, and which parts
 * of it may be edited.
 *
 * Self-editing is the most consequential thing JARVIS can do: the code it
 * writes runs in a server holding your API keys. So it is off unless
 * JARVIS_ALLOW_SELF_EDIT=1, every change lands in the sandbox copy rather than
 * the running app, every change the model makes needs your approval, and only
 * you can move a change from the sandbox into JARVIS proper.
 *
 * The sandbox protects the running JARVIS from broken code. It is not a
 * security boundary — the sandbox server is a process on the same machine —
 * which is why the approval gate stays on even there.
 */

export class SandboxPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxPathError";
  }
}

export function selfEditEnabled(): boolean {
  return process.env.JARVIS_ALLOW_SELF_EDIT === "1" && !isSandbox();
}

/** True inside the sandbox copy itself, which must never spawn a sandbox of its own. */
export function isSandbox(): boolean {
  return process.env.JARVIS_IS_SANDBOX === "1";
}

/** The running JARVIS — the code you use every day. */
export function liveRoot(): string {
  return path.resolve(process.env.JARVIS_LIVE_ROOT || process.cwd());
}

/**
 * The sandbox copy. Inside the project on purpose: Next.js looks upward for
 * the lockfile to decide its root, so a copy here (with no lockfile of its
 * own) runs from the same node_modules without a second install.
 */
export function sandboxRoot(): string {
  return path.resolve(process.env.JARVIS_SANDBOX_DIR || path.join(liveRoot(), ".sandbox", "app"));
}

export function sandboxPort(): number {
  const n = Number(process.env.JARVIS_SANDBOX_PORT ?? 3100);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 3100;
}

export function sandboxHost(): string {
  return process.env.JARVIS_SANDBOX_HOST || "127.0.0.1";
}

/** Folders copied into the sandbox and editable there: the whole app. */
export const SOURCE_DIRS = ["app", "components", "lib", "test", "scripts", "public"] as const;

/** Single files at the top level, copied and editable. */
export const SOURCE_FILES = [
  "proxy.ts",
  "instrumentation.ts",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".env.example",
  // Copied so the sandbox runs, but not editable — see PROTECTED.
  "package.json",
  "next-env.d.ts",
] as const;

/**
 * Copied but never editable or applied.
 *
 * package.json because a dependency change needs `npm install`, which a copy
 * of the file cannot do — applying it would leave JARVIS importing packages
 * that aren't there. next-env.d.ts because Next regenerates it.
 */
export const PROTECTED = new Set(["package.json", "next-env.d.ts"]);

/**
 * Downloaded model files, tens of megabytes, gitignored. Linked into the
 * sandbox rather than copied, and outside what an edit may touch.
 */
export const LINKED_ASSETS = ["public/models", "public/ort", "public/vad"] as const;

/** The sandbox's bookkeeping file, inside its root but never listed or applied. */
export const MANIFEST = ".jarvis-sandbox.json";

/** Text files only, and nothing that would be a surprise in a diff. */
export const MAX_FILE_BYTES = 1_000_000;

/** POSIX form of a relative path, which is what every API and the UI speak. */
export function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function isLinkedAsset(rel: string): boolean {
  return LINKED_ASSETS.some((asset) => rel === asset || rel.startsWith(`${asset}/`));
}

/** Does this relative path belong to the app's source, as far as copying goes? */
export function isSourcePath(rel: string): boolean {
  if (!rel || rel.includes("\0")) return false;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  // Dotfiles and dot-folders are config, caches or secrets (.env.local) —
  // except the one example file meant to be read.
  if (parts.some((p) => p.startsWith(".")) && rel !== ".env.example") return false;
  if (parts.includes("node_modules")) return false;
  if (isLinkedAsset(rel)) return false;
  if (parts.length === 1) {
    return (SOURCE_FILES as readonly string[]).includes(rel) || (SOURCE_DIRS as readonly string[]).includes(rel);
  }
  return (SOURCE_DIRS as readonly string[]).includes(parts[0]);
}

export function isEditable(rel: string): boolean {
  return isSourcePath(rel) && !PROTECTED.has(rel);
}

function contains(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

async function realOrNearest(target: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      return await fs.realpath(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/**
 * Turn a path from the model or the browser into a checked one.
 *
 * Returns the normalised relative path and its absolute location under
 * `root`. Same two-step check as the workspace tools: lexical first, then
 * again after following symlinks, because the linked model folders point out
 * of the sandbox and a write must never follow them.
 */
export async function resolveSource(
  input: string,
  root: string,
  { editable = false }: { editable?: boolean } = {},
): Promise<{ rel: string; abs: string }> {
  const raw = String(input ?? "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!raw) throw new SandboxPathError("No path given.");
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    throw new SandboxPathError(`Give a path relative to the project, like "components/ChatPane.tsx", not "${raw}".`);
  }

  const rel = path.posix.normalize(raw).replace(/\/+$/, "");
  if (rel.startsWith("../") || rel === "..") throw new SandboxPathError(`"${raw}" is outside JARVIS' code.`);

  if (editable ? !isEditable(rel) : !isSourcePath(rel)) {
    if (PROTECTED.has(rel)) {
      throw new SandboxPathError(
        `${rel} can't be edited here${rel === "package.json" ? " — a dependency change needs npm install, which only you can run" : ""}.`,
      );
    }
    throw new SandboxPathError(
      `"${rel}" isn't part of JARVIS' source. Editable: ${SOURCE_DIRS.join("/, ")}/ and top-level config files. ` +
        "Never .env files, data/, node_modules/ or the downloaded models.",
    );
  }

  const abs = path.join(root, ...rel.split("/"));
  const realRoot = await realOrNearest(root);
  const real = await realOrNearest(abs);
  if (!contains(realRoot, real)) throw new SandboxPathError(`"${rel}" resolves outside the sandbox. Refused.`);

  return { rel, abs };
}
