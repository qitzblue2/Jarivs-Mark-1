/**
 * Draws the app icons — the arc-reactor mark — with no image library: a signed
 * distance field per pixel, 3×3 supersampled for smooth edges, written out as
 * PNG with Node's own zlib. Run `npm run icons` to regenerate them; the output
 * is committed, so nothing needs this at build time.
 *
 *   public/icons/icon-192.png, icon-512.png   the "any" icons (rounded square)
 *   public/icons/maskable-512.png             full bleed, mark inside the safe zone
 *   app/icon.png                              the browser tab
 *   app/apple-icon.png                        the iOS home screen (iOS rounds it itself)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BG_A = [18, 28, 47];
const BG_B = [6, 9, 15];
const ARC = [56, 189, 248];
const CORE = [224, 247, 255];

/** One point of the icon, in 0..1 coordinates, as [r,g,b,a] with a in 0..1. */
function shade(x, y, { rounded }) {
  // Rounded-square silhouette (the "any" icons); full bleed otherwise.
  if (rounded) {
    const r = 0.2;
    const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
    const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
  }
  let color = mix(BG_A, BG_B, Math.min(1, (x + y) / 2 + 0.1));

  const d = Math.hypot(x - 0.5, y - 0.5);
  const angle = Math.atan2(y - 0.5, x - 0.5);
  const add = (rgb, amount) => {
    color = color.map((v, i) => v + (rgb[i] - v) * Math.min(1, Math.max(0, amount)));
  };

  // Outer ring with a soft glow.
  const outer = Math.abs(d - 0.335);
  add(ARC, Math.exp(-outer * 38) * 0.28);
  add(ARC, outer < 0.017 ? 1 : 0);

  // Inner ring, broken into three arcs.
  const inner = Math.abs(d - 0.215);
  const gap = Math.abs(((angle + Math.PI * 2 + Math.PI / 6) % ((Math.PI * 2) / 3)) - Math.PI / 3);
  if (inner < 0.011 && gap < Math.PI / 3 - 0.16) add(mix(ARC, [14, 165, 233], 0.4), 0.95);

  // Spokes between the rings.
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3 + Math.PI / 6 + Math.PI / 3;
    const along = (x - 0.5) * Math.cos(a) + (y - 0.5) * Math.sin(a);
    const across = Math.abs(-(x - 0.5) * Math.sin(a) + (y - 0.5) * Math.cos(a));
    if (across < 0.007 && along > 0.1 && along < 0.32) add(ARC, 0.5);
  }

  // The core.
  add(ARC, Math.exp(-d * 11) * 0.55);
  if (d < 0.09) add(mix(CORE, ARC, d / 0.09), 1);
  return [...color, 1];
}

function render(size, options) {
  const out = Buffer.alloc(size * size * 4);
  const N = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const [cr, cg, cb, ca] = shade((px + (sx + 0.5) / N) / size, (py + (sy + 0.5) / N) / size, options);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const o = (py * size + px) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return png(size, out);
}

mkdirSync("public/icons", { recursive: true });
const files = {
  "public/icons/icon-192.png": render(192, { rounded: true }),
  "public/icons/icon-512.png": render(512, { rounded: true }),
  "public/icons/maskable-512.png": render(512, { rounded: false }),
  "app/icon.png": render(96, { rounded: true }),
  "app/apple-icon.png": render(180, { rounded: false }),
};
for (const [path, bytes] of Object.entries(files)) {
  writeFileSync(path, bytes);
  console.log(`${path}  ${bytes.length} bytes`);
}
