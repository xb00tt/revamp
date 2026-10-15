// node packages/gui/scripts/icon.ts: draws the Revamp icon (two offset layers on a blue tile) into src-tauri/icons/icon.png.
// Shapes are signed-distance rounded rectangles, so edges are anti-aliased without an image library.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const SIZE = 512;
type Rgba = [number, number, number, number];

/** Signed distance from (x, y) to a rounded rectangle centred at (cx, cy) with half-size (hw, hh) and corner radius r. */
function roundRect(x: number, y: number, cx: number, cy: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const coverage = (d: number) => Math.min(1, Math.max(0, 0.5 - d));
const layers: Array<{ shape: (x: number, y: number) => number; color: Rgba }> = [
  { shape: (x, y) => roundRect(x, y, 256, 256, 240, 240, 112), color: [24, 95, 165, 255] },
  { shape: (x, y) => roundRect(x, y, 226, 226, 120, 120, 44), color: [133, 183, 235, 255] },
  { shape: (x, y) => roundRect(x, y, 290, 290, 120, 120, 44), color: [255, 255, 255, 235] },
];

const pixels = Buffer.alloc(SIZE * (SIZE * 4 + 1)); // one filter byte (0) per row
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let [r, g, b, a] = [0, 0, 0, 0];
    for (const { shape, color } of layers) {
      const alpha = (coverage(shape(x + 0.5, y + 0.5)) * color[3]) / 255;
      const out = alpha + (a / 255) * (1 - alpha);
      if (out === 0) continue;
      [r, g, b] = [0, 1, 2].map((i) => (color[i] * alpha + [r, g, b][i] * (a / 255) * (1 - alpha)) / out);
      a = out * 255;
    }
    pixels.set([r, g, b, a].map(Math.round), y * (SIZE * 4 + 1) + 1 + x * 4);
  }
}

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(fileURLToPath(new URL("../src-tauri/icons/icon.png", import.meta.url)), png);
console.log(`src-tauri/icons/icon.png written (${SIZE}×${SIZE}, ${png.length} bytes)`);
