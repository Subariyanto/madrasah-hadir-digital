// Generate PNG icons (192, 512, maskable 512) using only built-in modules.
// Pure-JS PNG encoder — emerald background + white "M" + green check.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- minimal PNG writer ----------
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- drawing primitives on rgba buffer ----------
function makeBuffer(w, h, rgba) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = rgba[0];
    buf[i * 4 + 1] = rgba[1];
    buf[i * 4 + 2] = rgba[2];
    buf[i * 4 + 3] = rgba[3];
  }
  return buf;
}
function setPx(buf, w, h, x, y, c) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  // alpha blend
  const a = c[3] / 255;
  buf[i]     = Math.round(buf[i]     * (1 - a) + c[0] * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + c[1] * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + c[2] * a);
  buf[i + 3] = 255;
}
function fillRoundedRect(buf, w, h, x0, y0, x1, y1, r, c) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let inside = true;
      // corners
      const cx = x < x0 + r ? x0 + r : x >= x1 - r ? x1 - 1 - r : x;
      const cy = y < y0 + r ? y0 + r : y >= y1 - r ? y1 - 1 - r : y;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r * r) inside = false;
      if (inside) setPx(buf, w, h, x, y, c);
    }
  }
}
function fillCircle(buf, w, h, cx, cy, r, c) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) setPx(buf, w, h, x, y, c);
    }
  }
}
function strokeLineThick(buf, w, h, x0, y0, x1, y1, thick, c) {
  // Bresenham + filled circle for thickness
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  const r = Math.floor(thick / 2);
  while (true) {
    fillCircle(buf, w, h, x, y, r, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
  }
}

// ---------- icon design ----------
const GREEN = [21, 128, 61, 255];        // #15803d
const GREEN_LIGHT = [22, 163, 74, 255];  // #16a34a
const WHITE = [255, 255, 255, 255];
const PALE = [240, 253, 244, 255];       // #f0fdf4

function drawIcon(size, maskable) {
  // Maskable needs a safe area: 80% inner. We just keep the full background green.
  const buf = makeBuffer(size, size, [0, 0, 0, 0]);

  // Background
  if (maskable) {
    // full-bleed solid green for maskable
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) setPx(buf, size, size, x, y, GREEN);
  } else {
    // rounded green tile
    const r = Math.round(size * 0.18);
    fillRoundedRect(buf, size, size, 0, 0, size, size, r, GREEN);
  }

  // Inner safe zone for content
  const pad = maskable ? Math.round(size * 0.18) : Math.round(size * 0.12);
  const inner = size - pad * 2;

  // Draw a stylized "M" with a check mark across the bottom right
  // M letter: 3 thick strokes
  const thick = Math.max(2, Math.round(inner * 0.14));
  const left = pad + Math.round(inner * 0.10);
  const right = pad + Math.round(inner * 0.90);
  const top = pad + Math.round(inner * 0.18);
  const bottom = pad + Math.round(inner * 0.78);
  const midX = Math.round((left + right) / 2);
  const midY = Math.round(top + (bottom - top) * 0.55);

  strokeLineThick(buf, size, size, left, bottom, left, top, thick, WHITE);
  strokeLineThick(buf, size, size, left, top, midX, midY, thick, WHITE);
  strokeLineThick(buf, size, size, midX, midY, right, top, thick, WHITE);
  strokeLineThick(buf, size, size, right, top, right, bottom, thick, WHITE);

  // Check badge (circle with checkmark) bottom-right
  const badgeR = Math.round(inner * 0.22);
  const badgeCX = pad + inner - badgeR + Math.round(badgeR * 0.15);
  const badgeCY = pad + inner - badgeR + Math.round(badgeR * 0.15);
  fillCircle(buf, size, size, badgeCX, badgeCY, badgeR, WHITE);
  fillCircle(buf, size, size, badgeCX, badgeCY, badgeR - Math.max(2, Math.round(badgeR * 0.12)), GREEN_LIGHT);

  // checkmark stroke
  const ct = Math.max(2, Math.round(badgeR * 0.22));
  const cx0 = badgeCX - Math.round(badgeR * 0.45);
  const cy0 = badgeCY + Math.round(badgeR * 0.05);
  const cx1 = badgeCX - Math.round(badgeR * 0.10);
  const cy1 = badgeCY + Math.round(badgeR * 0.40);
  const cx2 = badgeCX + Math.round(badgeR * 0.45);
  const cy2 = badgeCY - Math.round(badgeR * 0.30);
  strokeLineThick(buf, size, size, cx0, cy0, cx1, cy1, ct, WHITE);
  strokeLineThick(buf, size, size, cx1, cy1, cx2, cy2, ct, WHITE);

  return encodePNG(size, size, buf);
}

const targets = [
  { name: 'icon-192.png',           size: 192, maskable: false },
  { name: 'icon-512.png',           size: 512, maskable: false },
  { name: 'icon-maskable-512.png',  size: 512, maskable: true  },
  { name: 'icon-180.png',           size: 180, maskable: false }, // apple touch
  { name: 'favicon-32.png',         size: 32,  maskable: false }
];
for (const t of targets) {
  const png = drawIcon(t.size, t.maskable);
  fs.writeFileSync(path.join(OUT_DIR, t.name), png);
  console.log('wrote', t.name, png.length, 'bytes');
}
