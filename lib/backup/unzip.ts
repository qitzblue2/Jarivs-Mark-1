import { inflateRawSync } from "node:zlib";
import { crc32 } from "./zip";

/**
 * Reading a zip — ours, or one re-made by hand or by another tool.
 *
 * A backup file is input from outside the program, so nothing in it is
 * believed: every offset is checked against the buffer before it is used,
 * every entry's CRC is verified after it is read, and a compressed entry is
 * inflated with a hard output ceiling so a zip bomb stops at the limit
 * instead of filling memory. Entries are returned by name and bytes only;
 * deciding what any of them may be written to is restore.ts's job, never this
 * file's — nothing here touches a path.
 *
 * Supports stored and deflated entries (all that zip tools produce by
 * default). Zip64 is refused: a JARVIS backup is nowhere near 4GB.
 */

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipEntryInfo {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  /** Where this entry's local header begins. */
  offset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Per-file and total ceilings on what an archive may expand to. */
export const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
export const MAX_ENTRIES = 20_000;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The archive's table of contents. Throws ZipError on anything malformed. */
export function readZipDirectory(bytes: Uint8Array): ZipEntryInfo[] {
  const dv = view(bytes);
  if (bytes.length < 22) throw new ZipError("That isn't a zip file.");

  // The end-of-directory record is the last thing in the file, followed only
  // by an optional comment of up to 64KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ZipError("That isn't a zip file.");

  const count = dv.getUint16(eocd + 10, true);
  const directorySize = dv.getUint32(eocd + 12, true);
  const directoryOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new ZipError("Zip64 archives aren't supported.");
  if (count > MAX_ENTRIES) throw new ZipError(`Too many files in the archive (over ${MAX_ENTRIES}).`);
  if (directoryOffset + directorySize > bytes.length) throw new ZipError("The zip's directory is damaged.");

  const entries: ZipEntryInfo[] = [];
  let at = directoryOffset;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || dv.getUint32(at, true) !== CENTRAL) throw new ZipError("The zip's directory is damaged.");
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    if (at + 46 + nameLength > bytes.length) throw new ZipError("The zip's directory is damaged.");

    const compressedSize = dv.getUint32(at + 20, true);
    const size = dv.getUint32(at + 24, true);
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new ZipError("Zip64 archives aren't supported.");

    entries.push({
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: dv.getUint16(at + 10, true),
      crc: dv.getUint32(at + 16, true),
      compressedSize,
      size,
      offset: dv.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** One entry's contents, checked against its declared size and CRC. */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntryInfo, maxBytes = MAX_ENTRY_BYTES): Uint8Array {
  if (entry.size > maxBytes) throw new ZipError(`"${entry.name}" is too large (${entry.size} bytes).`);
  const dv = view(bytes);
  const at = entry.offset;
  if (at + 30 > bytes.length || dv.getUint32(at, true) !== LOCAL) throw new ZipError(`"${entry.name}" is damaged.`);

  const start = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ZipError(`"${entry.name}" is cut off.`);
  const raw = bytes.subarray(start, end);

  let data: Uint8Array;
  if (entry.method === 0) {
    data = raw;
  } else if (entry.method === 8) {
    try {
      // The ceiling is what makes a bomb stop; the declared size is not trusted.
      data = inflateRawSync(raw, { maxOutputLength: maxBytes });
    } catch {
      throw new ZipError(`"${entry.name}" is damaged or expands too far.`);
    }
  } else {
    throw new ZipError(`"${entry.name}" uses compression method ${entry.method}, which isn't supported.`);
  }

  if (data.length !== entry.size) throw new ZipError(`"${entry.name}" doesn't match its recorded size.`);
  if (crc32(data) !== entry.crc) throw new ZipError(`"${entry.name}" failed its checksum — the file is corrupt.`);
  return data;
}
