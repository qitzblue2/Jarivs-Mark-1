import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/data-dir";

/**
 * Pictures JARVIS has made, on disk under ./data/images.
 *
 * Not under public/: `next start` serves only what was in public/ at build
 * time, so a file written there afterwards 404s in production while working
 * perfectly in `next dev`. data/ is also where every other thing of yours
 * lives, it is already gitignored, and serving through /api/images keeps the
 * pictures behind the same login as the chats they came from.
 */

export interface ImageMeta {
  id: string;
  prompt: string;
  model: string;
  mime: string;
  bytes: number;
  createdAt: number;
  /** Set when the picture was an edit of another one. */
  editedFrom?: string;
}

const MIMES: Record<string, string> = { png: "png", jpeg: "jpg", webp: "webp", gif: "gif" };

/** Oldest pictures go once there are more than this. `JARVIS_IMAGE_KEEP=0` keeps everything. */
export function keepLimit(): number {
  const raw = process.env.JARVIS_IMAGE_KEEP;
  if (raw === undefined || raw === "") return 200;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200;
}

export function imageDir(): string {
  return process.env.JARVIS_IMAGE_DIR || dataPath("images");
}

export function isImageId(id: string): boolean {
  return /^[0-9a-f-]{36}$/.test(id);
}

/** Pull an id out of "/api/images/<id>", a bare id, or anything ending in one. */
export function imageIdFrom(ref: string): string | null {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(ref.trim());
  return match ? match[1] : null;
}

/** Identify an image by its first bytes. A provider's claimed type is not trusted. */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  return null;
}

function extFor(mime: string): string {
  return MIMES[mime.replace("image/", "")] ?? "bin";
}

function metaPath(id: string): string {
  return path.join(imageDir(), `${id}.json`);
}

export async function saveImage(
  bytes: Buffer,
  info: { prompt: string; model: string; editedFrom?: string },
): Promise<ImageMeta> {
  const mime = sniffMime(bytes);
  if (!mime) throw new Error("The provider sent back something that isn't an image.");

  const meta: ImageMeta = {
    id: randomUUID(),
    prompt: info.prompt,
    model: info.model,
    mime,
    bytes: bytes.length,
    createdAt: Date.now(),
    ...(info.editedFrom ? { editedFrom: info.editedFrom } : {}),
  };

  await fs.mkdir(imageDir(), { recursive: true });
  await fs.writeFile(path.join(imageDir(), `${meta.id}.${extFor(mime)}`), bytes);
  // Written second, so a listing never shows a picture whose file is missing.
  await fs.writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2));

  await pruneImages().catch(() => {});
  return meta;
}

export async function getImageMeta(id: string): Promise<ImageMeta | null> {
  if (!isImageId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(metaPath(id), "utf8")) as ImageMeta;
  } catch {
    return null;
  }
}

export async function readImage(id: string): Promise<{ meta: ImageMeta; bytes: Buffer } | null> {
  const meta = await getImageMeta(id);
  if (!meta) return null;
  try {
    const bytes = await fs.readFile(path.join(imageDir(), `${id}.${extFor(meta.mime)}`));
    return { meta, bytes };
  } catch {
    return null;
  }
}

/** Newest first. */
export async function listImages(): Promise<ImageMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(imageDir());
  } catch {
    return [];
  }

  const metas: ImageMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const meta = await getImageMeta(entry.slice(0, -5));
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteImage(id: string): Promise<boolean> {
  const meta = await getImageMeta(id);
  if (!meta) return false;
  await fs.rm(path.join(imageDir(), `${id}.${extFor(meta.mime)}`), { force: true });
  await fs.rm(metaPath(id), { force: true });
  return true;
}

/** Drop the oldest pictures past `keepLimit()`. Returns how many went. */
export async function pruneImages(limit = keepLimit()): Promise<number> {
  if (limit === 0) return 0;
  const all = await listImages();
  const stale = all.slice(limit);
  for (const meta of stale) await deleteImage(meta.id);
  return stale.length;
}

/** Where the browser, the display and the model all find a picture. */
export function imageUrl(id: string): string {
  return `/api/images/${id}`;
}
