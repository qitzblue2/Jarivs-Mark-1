/**
 * A minimal zip writer: stored (uncompressed) entries, streamed one file at a
 * time.
 *
 * Written here rather than pulled in because the whole need is "put some
 * files in a box every OS can open", and a dependency for that is a supply
 * chain for a hundred lines. Stored rather than deflated because most of the
 * bulk is PNGs, which are already compressed, and JSON chats are small.
 *
 * Limits of the format without zip64, checked rather than assumed: under
 * 65,535 entries and 4GB in total.
 */

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: Uint8Array;
  mtime?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is what zip stores. Two-second resolution. */
function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const MAX_ENTRIES = 0xffff;
const MAX_OFFSET = 0xffffffff;

/**
 * Stream a zip from entries produced one at a time, so a folder of pictures
 * is never held in memory all at once.
 */
export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  const iterator = entries[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (!next.done) {
          const entry = next.value;
          const name = encoder.encode(entry.name.replace(/^\/+/, ""));
          const crc = crc32(entry.data);
          const size = entry.data.length;
          const { time, date } = dosTime(entry.mtime ?? new Date());

          if (++count > MAX_ENTRIES) throw new Error("Too many files for one backup.");
          if (offset + 30 + name.length + size > MAX_OFFSET) throw new Error("Backup would be over 4GB.");

          // Bit 11: names are UTF-8, so a chat titled in any language survives.
          const flags = 0x0800;
          const local = new DataView(new ArrayBuffer(30));
          local.setUint32(0, 0x04034b50, true);
          local.setUint16(4, 20, true);
          local.setUint16(6, flags, true);
          local.setUint16(8, 0, true); // stored
          local.setUint16(10, time, true);
          local.setUint16(12, date, true);
          local.setUint32(14, crc, true);
          local.setUint32(18, size, true);
          local.setUint32(22, size, true);
          local.setUint16(26, name.length, true);
          local.setUint16(28, 0, true);

          const header = new DataView(new ArrayBuffer(46));
          header.setUint32(0, 0x02014b50, true);
          header.setUint16(4, 20, true);
          header.setUint16(6, 20, true);
          header.setUint16(8, flags, true);
          header.setUint16(10, 0, true);
          header.setUint16(12, time, true);
          header.setUint16(14, date, true);
          header.setUint32(16, crc, true);
          header.setUint32(20, size, true);
          header.setUint32(24, size, true);
          header.setUint16(28, name.length, true);
          header.setUint32(42, offset, true);
          central.push(new Uint8Array(header.buffer), name);

          controller.enqueue(new Uint8Array(local.buffer));
          controller.enqueue(name);
          controller.enqueue(entry.data);
          offset += 30 + name.length + size;
          return;
        }

        const centralSize = central.reduce((sum, part) => sum + part.length, 0);
        for (const part of central) controller.enqueue(part);

        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, count, true);
        end.setUint16(10, count, true);
        end.setUint32(12, centralSize, true);
        end.setUint32(16, offset, true);
        controller.enqueue(new Uint8Array(end.buffer));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
