import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/data-dir";

/**
 * Videos made by JARVIS, on disk under ./data/videos — the same arrangement as
 * pictures (see lib/images/store.ts): outside public/, so they are served
 * through /api/videos behind the same login as your chats. Each is an MP4 plus a
 * small JSON note of how it was made.
 */
export interface VideoMeta {
  id: string;
  /** What was asked for, as written in the studio. */
  scene: string;
  speech?: string;
  sound?: string;
  model: string;
  aspect: string;
  seconds: number;
  quality: string;
  bytes: number;
  createdAt: number;
}

export const isVideoId = (id: string): boolean => /^[0-9a-f-]{36}$/.test(id);
export const videoDir = (): string => process.env.JARVIS_VIDEO_DIR || dataPath("videos");
export const videoUrl = (id: string): string => `/api/videos/${id}`;

/** Oldest videos go once there are more than this. They are big. `JARVIS_VIDEO_KEEP=0` keeps all. */
export function videoKeepLimit(): number {
  const raw = process.env.JARVIS_VIDEO_KEEP;
  if (raw === undefined || raw === "") return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}

/** An MP4 (or MOV) starts with a size and then "ftyp"; a provider's claimed type is not trusted. */
export function isMp4(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

const metaPath = (id: string) => path.join(videoDir(), `${id}.json`);
const filePath = (id: string) => path.join(videoDir(), `${id}.mp4`);

export async function saveVideo(bytes: Buffer, info: Omit<VideoMeta, "id" | "bytes" | "createdAt">): Promise<VideoMeta> {
  if (!isMp4(bytes)) throw new Error("The provider sent back something that isn't a video.");
  const meta: VideoMeta = { ...info, id: randomUUID(), bytes: bytes.length, createdAt: Date.now() };
  await fs.mkdir(videoDir(), { recursive: true });
  await fs.writeFile(filePath(meta.id), bytes);
  // Written second, so a listing never shows a video whose file is missing.
  await fs.writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2));
  await pruneVideos().catch(() => {});
  return meta;
}

export async function getVideoMeta(id: string): Promise<VideoMeta | null> {
  if (!isVideoId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(metaPath(id), "utf8")) as VideoMeta;
  } catch {
    return null;
  }
}

export async function statVideo(id: string): Promise<{ meta: VideoMeta; size: number } | null> {
  const meta = await getVideoMeta(id);
  if (!meta) return null;
  try {
    return { meta, size: (await fs.stat(filePath(id))).size };
  } catch {
    return null;
  }
}

/** The file's bytes from `start` to `end` inclusive — for seeking without reading the whole video. */
export async function readVideoRange(id: string, start: number, end: number): Promise<Buffer> {
  const handle = await fs.open(filePath(id), "r");
  try {
    const length = end - start + 1;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Newest first. */
export async function listVideos(): Promise<VideoMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(videoDir());
  } catch {
    return [];
  }
  const metas: VideoMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const meta = await getVideoMeta(entry.slice(0, -5));
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteVideo(id: string): Promise<boolean> {
  const meta = await getVideoMeta(id);
  if (!meta) return false;
  await fs.rm(filePath(id), { force: true });
  await fs.rm(metaPath(id), { force: true });
  return true;
}

export async function pruneVideos(limit = videoKeepLimit()): Promise<number> {
  if (limit === 0) return 0;
  const stale = (await listVideos()).slice(limit);
  for (const meta of stale) await deleteVideo(meta.id);
  return stale.length;
}

/** Parse a `Range: bytes=a-b` header against a file of `size` bytes. Null means serve the whole thing; "bad" means 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "bad" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "bad";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // "-500": the last 500 bytes.
    const n = Number(m[2]);
    if (n === 0) return "bad";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "bad";
  return { start, end };
}
