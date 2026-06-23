// Generates a 1024×1024 PNG app icon with a brand gradient background and a
// stylized bar-chart + trend-line mark. Dependency-free (zlib only).
//
// Run: node scripts/make-icon.mjs   →  writes src-tauri/source-icon.png
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src-tauri', 'source-icon.png');

// ---------- helpers ----------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Indigo→blue gradient matching the app's --primary (217°, ~#3b82f6 → indigo #6366f1).
const TOP = [99, 102, 241];   // indigo-500
const BOTTOM = [37, 99, 235]; // blue-600

function gradientColor(x, y) {
  const t = y / (SIZE - 1);
  return [Math.round(lerp(TOP[0], BOTTOM[0], t)), Math.round(lerp(TOP[1], BOTTOM[1], t)), Math.round(lerp(TOP[2], BOTTOM[2], t))];
}

// Rounded-rect mask: icon fills a rounded square (squircle-ish).
const RADIUS = 220;
function insideRoundedRect(x, y) {
  if (x < RADIUS && y < RADIUS) return Math.hypot(RADIUS - x, RADIUS - y) <= RADIUS;
  if (x > SIZE - RADIUS && y < RADIUS) return Math.hypot(x - (SIZE - RADIUS), RADIUS - y) <= RADIUS;
  if (x < RADIUS && y > SIZE - RADIUS) return Math.hypot(RADIUS - x, y - (SIZE - RADIUS)) <= RADIUS;
  if (x > SIZE - RADIUS && y > SIZE - RADIUS) return Math.hypot(x - (SIZE - RADIUS), y - (SIZE - RADIUS)) <= RADIUS;
  return true;
}

// Anti-aliased coverage for the rounded-rect edge.
function coverage(x, y) {
  const eps = 1.0;
  const inside = (() => {
    if (x < RADIUS && y < RADIUS) return RADIUS - Math.hypot(RADIUS - x, RADIUS - y);
    if (x > SIZE - RADIUS && y < RADIUS) return RADIUS - Math.hypot(x - (SIZE - RADIUS), RADIUS - y);
    if (x < RADIUS && y > SIZE - RADIUS) return RADIUS - Math.hypot(RADIUS - x, y - (SIZE - RADIUS));
    if (x > SIZE - RADIUS && y > SIZE - RADIUS) return RADIUS - Math.hypot(x - (SIZE - RADIUS), y - (SIZE - RADIUS));
    return 999;
  })();
  return clamp(inside / eps + 0.5, 0, 1);
}

// Bars: 4 vertical bars of increasing height (a usage chart), plus a trend line.
const BARS = [
  { x: 250, w: 90, h: 200 },
  { x: 380, w: 90, h: 320 },
  { x: 510, w: 90, h: 250 },
  { x: 640, w: 90, h: 440 },
];
const BAR_BOTTOM = 740;
const BAR_COLOR = [255, 255, 255];

function inBar(x, y) {
  for (const b of BARS) {
    if (x >= b.x && x <= b.x + b.w && y >= BAR_BOTTOM - b.h && y <= BAR_BOTTOM) return true;
  }
  return false;
}

// Trend line (white) over the bars: from (250, 540) → (640+90, 300).
function lineSDF(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((x - x1) * dx + (y - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const px = x1 + t * dx, py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

function onTrendLine(x, y) {
  return lineSDF(x, y, 250, BAR_BOTTOM - BARS[0].h + 40, BARS[3].x + BARS[3].w, BAR_BOTTOM - BARS[3].h + 40) <= 14;
}

// ---------- rasterize ----------
const bytes = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const cover = coverage(x, y);
    const [r, g, b] = gradientColor(x, y);
    let alpha = cover;
    let cr = r, cg = g, cb = b;
    if (cover > 0) {
      // Only draw the mark inside the rounded rect.
      if (inBar(x, y)) {
        cr = lerp(cr, BAR_COLOR[0], 0.92);
        cg = lerp(cg, BAR_COLOR[1], 0.92);
        cb = lerp(cb, BAR_COLOR[2], 0.92);
      }
      if (onTrendLine(x, y)) {
        cr = 255; cg = 255; cb = 255;
      }
    }
    bytes[i] = Math.round(cr);
    bytes[i + 1] = Math.round(cg);
    bytes[i + 2] = Math.round(cb);
    bytes[i + 3] = Math.round(alpha * 255);
  }
}

// ---------- encode PNG ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Raw image data: prepend filter byte (0 = none) per scanline.
const stride = SIZE * 4;
const raw = Buffer.alloc((stride + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (stride + 1)] = 0;
  bytes.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
}
const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`Wrote ${OUT} (${(png.length / 1024).toFixed(1)} KB)`);
