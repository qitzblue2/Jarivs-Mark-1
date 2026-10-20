import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Filesystem containment.
 *
 * A language model picks these paths and this process resolves them, so every
 * one is hostile input. `../` traversal is the obvious attack; the subtle one
 * is a symlink *inside* the workspace pointing out of it, which a naive
 * string-prefix check waves straight through. Both are handled by resolving
 * the real path and re-checking containment afterwards.
 *
 * Same posture as lib/tools/net-guard.ts, for the same reason.
 */

export class OutsideWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutsideWorkspaceError";
  }
}

export const MAX_READ_BYTES = 400_000;
export const MAX_WRITE_BYTES = 2_000_000;

/** Root of everything JARVIS may touch. */
export function workspaceRoot(): string {
  return path.resolve(process.env.JARVIS_WORKSPACE || path.join(process.cwd(), "workspace"));
}

/** Computer access is off unless explicitly enabled by an env var. */
export function computerAccessEnabled(): boolean {
  return process.env.JARVIS_ALLOW_COMPUTER === "1";
}

async function realOrNearest(target: string): Promise<string> {
  // A file being created doesn't exist yet, so resolve the nearest existing
  // ancestor — that is what a symlink would have to subvert.
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

function contains(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  // The separator matters: "/wsX" must not count as inside "/ws".
  return candidate.startsWith(root + path.sep);
}

/**
 * Resolve a model-supplied path to an absolute path inside the workspace,
 * or throw.
 */
export async function resolveInWorkspace(input: string): Promise<string> {
  const root = workspaceRoot();
  const raw = String(input ?? "").trim();

  if (!raw) throw new OutsideWorkspaceError("No path given.");
  if (raw.includes("\0")) throw new OutsideWorkspaceError("Path contains a null byte.");

  // An absolute path is only acceptable if it is already inside the root.
  const joined = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);

  // Cheap lexical check first — catches plain ../ before touching the disk.
  if (!contains(root, joined)) {
    throw new OutsideWorkspaceError(
      `"${raw}" is outside the workspace. Only paths under ${root} can be accessed.`,
    );
  }

  // Then the real check: follow symlinks and verify containment again.
  const realRoot = await realOrNearest(root);
  const real = await realOrNearest(joined);

  if (!contains(realRoot, real)) {
    throw new OutsideWorkspaceError(
      `"${raw}" resolves outside the workspace (symlink escape). Refused.`,
    );
  }

  return joined;
}

/** Workspace-relative form, for display back to the model and the UI. */
export function relative(absolute: string): string {
  return path.relative(workspaceRoot(), absolute) || ".";
}

export async function ensureWorkspace(): Promise<string> {
  const root = workspaceRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

/**
 * The environment a spawned command gets.
 *
 * Every API key is removed. Without this, `env` or `printenv` — or anything
 * the model can be talked into running — hands out the Groq, Cerebras and
 * Tavily keys, which is a worse outcome than any file it could read.
 */
export function scrubbedEnv(): Record<string, string> {
  const clean: Record<string, string> = {};
  const secret = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION|COOKIE|PRIVATE/i;

  for (const [name, value] of Object.entries(process.env)) {
    if (secret.test(name)) continue;
    if (name.startsWith("JARVIS_")) continue;
    if (name.startsWith("npm_")) continue;
    if (value !== undefined) clean[name] = value;
  }

  // Keep just enough for ordinary tools to work.
  if (process.env.PATH) clean.PATH = process.env.PATH;
  if (process.env.HOME) clean.HOME = process.env.HOME;
  clean.LANG = process.env.LANG ?? "C.UTF-8";
  // Not a secret, and Next's ProcessEnv type requires it.
  clean.NODE_ENV = process.env.NODE_ENV ?? "development";
  return clean;
}
