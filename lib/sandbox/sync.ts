import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  isSourcePath,
  LINKED_ASSETS,
  liveRoot,
  MANIFEST,
  MAX_FILE_BYTES,
  PROTECTED,
  resolveSource,
  sandboxRoot,
  SOURCE_DIRS,
  SOURCE_FILES,
  toPosix,
} from "./paths";

/**
 * Keeping the sandbox copy and the running JARVIS apart, and moving changes
 * between them only when asked.
 *
 * When the sandbox is made, the hash of every file it copied is written to a
 * manifest. That record is what makes everything else safe:
 *
 *   A change is anything in the sandbox that differs from the manifest — not
 *   from the live file, which may have moved on since (a `git pull`).
 *
 *   Applying refuses any file whose live copy no longer matches the manifest,
 *   because overwriting it would silently discard whatever changed it.
 *
 *   Undo refuses a file that changed again after it was applied, for the
 *   same reason.
 */

export interface Manifest {
  createdAt: number;
  /** Relative path → sha256 of the live file when it was last in step with the sandbox. */
  base: Record<string, string>;
}

export type ChangeStatus = "modified" | "added" | "deleted";

export interface Change {
  path: string;
  status: ChangeStatus;
  /** The live file changed since the sandbox last matched it; applying would overwrite that. */
  conflict: boolean;
}

export interface Promotion {
  id: string;
  at: number;
  files: { path: string; status: ChangeStatus; afterHash: string | null }[];
  /** Set once undone, so it can't be undone twice. */
  undoneAt?: number;
}

export function sha(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function hashFile(abs: string): Promise<string | null> {
  try {
    return sha(await fs.readFile(abs));
  } catch {
    return null;
  }
}

/** Every source file under a root, as POSIX relative paths, sorted. */
export async function listSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(rel: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (!isSourcePath(child)) continue;
      // Symlinks are never followed: the linked model folders are the only
      // ones expected, and they are excluded above anyway.
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) {
        const { size } = await fs.stat(path.join(root, child));
        if (size <= MAX_FILE_BYTES) out.push(child);
      }
    }
  }

  for (const dir of SOURCE_DIRS) await walk(dir);
  for (const file of SOURCE_FILES) {
    try {
      const stat = await fs.lstat(path.join(root, file));
      if (stat.isFile() && stat.size <= MAX_FILE_BYTES) out.push(file);
    } catch {
      /* not present in this install */
    }
  }
  return out.sort();
}

function manifestPath(): string {
  return path.join(sandboxRoot(), MANIFEST);
}

export async function readManifest(): Promise<Manifest | null> {
  try {
    return JSON.parse(await fs.readFile(manifestPath(), "utf8")) as Manifest;
  } catch {
    return null;
  }
}

async function writeManifest(manifest: Manifest): Promise<void> {
  await fs.writeFile(manifestPath(), JSON.stringify(manifest, null, 2));
}

/** Refuse a configuration where wiping the sandbox could touch JARVIS itself. */
function assertSeparate(): void {
  const live = liveRoot();
  const box = sandboxRoot();
  if (box === live || live.startsWith(box + path.sep) || box === path.parse(box).root) {
    throw new Error(`Refusing to use ${box} as the sandbox: it contains JARVIS itself.`);
  }
}

/**
 * Make a fresh sandbox: a copy of JARVIS' source as it is right now.
 *
 * Anything already in the sandbox is discarded, including unapplied changes —
 * the UI asks before calling this.
 */
export async function resetSandbox(): Promise<Manifest> {
  assertSeparate();
  const live = liveRoot();
  const box = sandboxRoot();

  // Everything goes but the sandbox's own chats and settings. The build cache
  // goes too: a reset is the way out of a sandbox that won't build, and a
  // cache that remembers a broken build would carry it straight back in.
  // A sandbox folder pointed somewhere by mistake (JARVIS_SANDBOX_DIR=~)
  // must not be emptied: only a folder that is empty or already ours is.
  const existing = await fs.readdir(box).catch(() => [] as string[]);
  if (existing.length > 0 && !existing.includes(MANIFEST)) {
    throw new Error(
      `${box} has files in it that aren't a JARVIS sandbox, so it won't be cleared. ` +
        "Point JARVIS_SANDBOX_DIR at an empty or new folder.",
    );
  }

  try {
    for (const entry of await fs.readdir(box)) {
      if (entry === "data") continue;
      await fs.rm(path.join(box, entry), { recursive: true, force: true });
    }
  } catch {
    /* no sandbox yet */
  }
  await fs.mkdir(box, { recursive: true });

  const base: Record<string, string> = {};
  for (const rel of await listSourceFiles(live)) {
    const from = path.join(live, ...rel.split("/"));
    const to = path.join(box, ...rel.split("/"));
    await fs.mkdir(path.dirname(to), { recursive: true });
    const data = await fs.readFile(from);
    await fs.writeFile(to, data);
    base[rel] = sha(data);
  }

  // The voice models are tens of megabytes; link them rather than copy.
  for (const asset of LINKED_ASSETS) {
    const from = path.join(live, ...asset.split("/"));
    const to = path.join(box, ...asset.split("/"));
    try {
      await fs.access(from);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.symlink(from, to, "dir");
    } catch {
      /* not downloaded on this install */
    }
  }

  const manifest: Manifest = { createdAt: Date.now(), base };
  await writeManifest(manifest);
  return manifest;
}


/** The sandbox, made on first use. */
export async function ensureSandbox(): Promise<Manifest> {
  return (await readManifest()) ?? resetSandbox();
}

/** What the sandbox has that JARVIS doesn't, relative to when they last matched. */
export async function listChanges(): Promise<Change[]> {
  const manifest = await ensureSandbox();
  const live = liveRoot();
  const box = sandboxRoot();
  const files = new Set(await listSourceFiles(box));
  const changes: Change[] = [];

  const liveMoved = async (rel: string) => {
    const now = await hashFile(path.join(live, ...rel.split("/")));
    return now !== (manifest.base[rel] ?? null);
  };

  for (const rel of files) {
    if (PROTECTED.has(rel)) continue;
    const hash = await hashFile(path.join(box, ...rel.split("/")));
    const base = manifest.base[rel];
    if (base === undefined) changes.push({ path: rel, status: "added", conflict: await liveMoved(rel) });
    else if (hash !== base) changes.push({ path: rel, status: "modified", conflict: await liveMoved(rel) });
  }
  for (const rel of Object.keys(manifest.base)) {
    if (!files.has(rel) && !PROTECTED.has(rel)) {
      changes.push({ path: rel, status: "deleted", conflict: await liveMoved(rel) });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** A file's text in the sandbox and in JARVIS, either of which may be missing. */
export async function readBoth(rel: string): Promise<{ sandbox: string | null; live: string | null }> {
  const read = (root: string) =>
    fs.readFile(path.join(root, ...rel.split("/")), "utf8").catch(() => null);
  return { sandbox: await read(sandboxRoot()), live: await read(liveRoot()) };
}

/** Write one file in the sandbox. Paths are checked; the caller decides whether to ask first. */
export async function writeSandboxFile(input: string, content: string): Promise<{ rel: string; created: boolean }> {
  await ensureSandbox();
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new Error(`That's over the ${MAX_FILE_BYTES.toLocaleString()} byte limit for one file.`);
  }
  const { rel, abs } = await resolveSource(input, sandboxRoot(), { editable: true });
  const created = !(await fs.stat(abs).then((s) => s.isFile()).catch(() => false));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return { rel, created };
}

export async function deleteSandboxFile(input: string): Promise<string> {
  await ensureSandbox();
  const { rel, abs } = await resolveSource(input, sandboxRoot(), { editable: true });
  await fs.rm(abs);
  return rel;
}

/** Put a sandbox file back the way JARVIS has it. */
export async function revertSandboxFile(input: string): Promise<string> {
  const manifest = await ensureSandbox();
  const { rel, abs } = await resolveSource(input, sandboxRoot(), { editable: true });
  const liveAbs = path.join(liveRoot(), ...rel.split("/"));
  const data = await fs.readFile(liveAbs).catch(() => null);
  if (data === null) {
    await fs.rm(abs, { force: true });
    delete manifest.base[rel];
  } else {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
    manifest.base[rel] = sha(data);
  }
  await writeManifest(manifest);
  return rel;
}

// --- applying to JARVIS, and taking it back ---

function historyDir(): string {
  return path.join(liveRoot(), "data", "self-edit");
}

/**
 * Where a file's pre-apply copy is kept. The .orig suffix matters: saved as
 * ChatPane.tsx it was picked up by the type checker as part of the app — with
 * imports that don't resolve from there — and broke `npm run build`.
 */
function backupPath(dir: string, rel: string): string {
  return `${path.join(dir, "before", ...rel.split("/"))}.orig`;
}

async function readPromotion(id: string): Promise<Promotion | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(historyDir(), id, "promotion.json"), "utf8")) as Promotion;
  } catch {
    return null;
  }
}

export async function listPromotions(): Promise<Promotion[]> {
  let ids: string[] = [];
  try {
    ids = await fs.readdir(historyDir());
  } catch {
    return [];
  }
  const all = (await Promise.all(ids.map(readPromotion))).filter((p): p is Promotion => p !== null);
  return all.sort((a, b) => b.at - a.at);
}

export class ConflictError extends Error {
  constructor(
    message: string,
    readonly paths: string[],
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Copy the sandbox's changes into the running JARVIS.
 *
 * All or nothing on conflicts: if any live file moved on since the sandbox
 * copied it, nothing is written. Before anything is written, the live
 * version of every file about to change is saved, so the whole promotion can
 * be undone.
 */
export async function promote(only?: string[]): Promise<Promotion> {
  const manifest = await ensureSandbox();
  let changes = await listChanges();
  if (only?.length) changes = changes.filter((c) => only.includes(c.path));
  if (changes.length === 0) throw new Error("Nothing to apply — the sandbox matches JARVIS.");

  const conflicts = changes.filter((c) => c.conflict).map((c) => c.path);
  if (conflicts.length > 0) {
    throw new ConflictError(
      `JARVIS' own copy of ${conflicts.join(", ")} changed since the sandbox was made, so applying would ` +
        "overwrite that. Revert those files in the sandbox, or reset it, then make the change again.",
      conflicts,
    );
  }

  const live = liveRoot();
  const box = sandboxRoot();
  const promotion: Promotion = { id: randomUUID(), at: Date.now(), files: [] };
  const dir = path.join(historyDir(), promotion.id);
  await fs.mkdir(path.join(dir, "before"), { recursive: true });

  // Save first, write second: a failure halfway leaves a complete backup.
  for (const change of changes) {
    if (change.status === "added") continue;
    const from = path.join(live, ...change.path.split("/"));
    const to = backupPath(dir, change.path);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }

  for (const change of changes) {
    const target = path.join(live, ...change.path.split("/"));
    if (change.status === "deleted") {
      await fs.rm(target, { force: true });
      delete manifest.base[change.path];
      promotion.files.push({ path: change.path, status: change.status, afterHash: null });
      continue;
    }
    const data = await fs.readFile(path.join(box, ...change.path.split("/")));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    manifest.base[change.path] = sha(data);
    promotion.files.push({ path: change.path, status: change.status, afterHash: sha(data) });
  }

  await fs.writeFile(path.join(dir, "promotion.json"), JSON.stringify(promotion, null, 2));
  await writeManifest(manifest);
  return promotion;
}

/** Put JARVIS back the way it was before a promotion. */
export async function undoPromotion(id: string): Promise<Promotion> {
  const promotion = await readPromotion(id);
  if (!promotion) throw new Error("No such change to undo.");
  if (promotion.undoneAt) throw new Error("That change was already undone.");

  const live = liveRoot();
  const dir = path.join(historyDir(), promotion.id);

  const moved: string[] = [];
  for (const file of promotion.files) {
    const now = await hashFile(path.join(live, ...file.path.split("/")));
    if (now !== file.afterHash) moved.push(file.path);
  }
  if (moved.length > 0) {
    throw new ConflictError(
      `${moved.join(", ")} changed again after this was applied; undoing would throw that away.`,
      moved,
    );
  }

  const manifest = await ensureSandbox();
  for (const file of promotion.files) {
    const target = path.join(live, ...file.path.split("/"));
    if (file.status === "added") {
      await fs.rm(target, { force: true });
      delete manifest.base[file.path];
    } else {
      const saved = await fs
        .readFile(backupPath(dir, file.path))
        // Backups from before the .orig suffix.
        .catch(() => fs.readFile(path.join(dir, "before", ...file.path.split("/"))));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, saved);
      // The sandbox still holds the change, so it shows as unapplied again.
      manifest.base[file.path] = sha(saved);
    }
  }
  await writeManifest(manifest);

  promotion.undoneAt = Date.now();
  await fs.writeFile(path.join(dir, "promotion.json"), JSON.stringify(promotion, null, 2));
  return promotion;
}

/**
 * One value that changes whenever the sandbox's pending changes do, so a
 * passing check is only trusted for exactly the code it ran against.
 */
export async function changesFingerprint(): Promise<string> {
  const box = sandboxRoot();
  const parts: string[] = [];
  for (const change of await listChanges()) {
    const hash = change.status === "deleted" ? "-" : await hashFile(path.join(box, ...change.path.split("/")));
    parts.push(`${change.status}:${change.path}:${hash}`);
  }
  return sha(parts.join("\n"));
}
