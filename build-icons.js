/**
 * Regenerates icons/icon{16,48,128}.png from the geometry in icons/icon.svg.
 *
 * The extension has no build step and the machine has no SVG rasteriser, so
 * the shapes are drawn analytically here and encoded with Node's zlib. Run
 * with `node build-icons.js` after changing the artwork.
 *
 * 16px gets a simplified drawing (see icons/icon-16.svg): the scrubber and the
 * second chevron collapse into noise at that size.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'icons');
const SS = 4;      // supersampling factor per axis, for anti-aliasing
const DESIGN = 96; // design-space units (matches the SVG viewBox)

// ─── Geometry helpers (all in design space) ──────────────────────────

function inRoundedRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const dx = Math.min(Math.max(x, rx + r), rx + w - r);
  const dy = Math.min(Math.max(y, ry + r), ry + h - r);
  const ox = x - dx, oy = y - dy;
  return ox * ox + oy * oy <= r * r;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const s = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const t = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const u = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TOP = hex('#ff3b30');
const BOTTOM = hex('#c00000');
const GREEN = hex('#00d400');

/** Colour of the icon at a point, or null for transparent. */
function sample(x, y, detailed) {
  if (!inRoundedRect(x, y, 0, 0, DESIGN, DESIGN, 21)) return null;

  // Badge gradient, top to bottom.
  const t = y / DESIGN;
  let rgb = [
    TOP[0] + (BOTTOM[0] - TOP[0]) * t,
    TOP[1] + (BOTTOM[1] - TOP[1]) * t,
    TOP[2] + (BOTTOM[2] - TOP[2]) * t
  ];

  if (detailed) {
    // Two chevrons + bar, sitting above the scrubber.
    if (inTriangle(x, y, 23, 25, 45, 44, 23, 63) ||
        inTriangle(x, y, 43, 25, 65, 44, 43, 63) ||
        inRoundedRect(x, y, 67, 25, 7, 38, 3.5)) {
      rgb = [255, 255, 255];
    } else if (inRoundedRect(x, y, 50, 72, 18, 6, 3)) {
      rgb = GREEN;                                   // the sponsor segment
    } else if (inRoundedRect(x, y, 20, 72, 56, 6, 3)) {
      rgb = [rgb[0] + (255 - rgb[0]) * 0.32,         // scrubber track, 32% white
             rgb[1] + (255 - rgb[1]) * 0.32,
             rgb[2] + (255 - rgb[2]) * 0.32];
    }
  } else {
    // Simplified: one chunky chevron + bar, nothing else.
    if (inTriangle(x, y, 24, 22, 57, 48, 24, 74) ||
        inRoundedRect(x, y, 61, 22, 11, 52, 5)) {
      rgb = [255, 255, 255];
    }
  }

  return rgb;
}

// ─── Raster + PNG encode ─────────────────────────────────────────────

function render(size, detailed) {
  const px = Buffer.alloc(size * size * 4);
  const step = DESIGN / (size * SS);

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = (pxi * SS + sx + 0.5) * step;
          const dy = (py * SS + sy + 0.5) * step;
          const c = sample(dx, dy, detailed);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }

      const n = SS * SS;
      const i = (py * size + pxi) * 4;
      const cov = a / n;
      // Straight (non-premultiplied) alpha: average colour over covered
      // samples only, otherwise edges darken toward black.
      const covered = a / 255;
      px[i]     = covered ? Math.round(r / covered) : 0;
      px[i + 1] = covered ? Math.round(g / covered) : 0;
      px[i + 2] = covered ? Math.round(b / covered) : 0;
      px[i + 3] = Math.round(cov);
    }
  }
  return px;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // 10,11,12 = deflate / adaptive filtering / no interlace, all 0

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const [size, detailed] of [[16, false], [48, true], [128, true]]) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size, detailed)));
  console.log(`wrote ${path.relative(__dirname, file)}  ${fs.statSync(file).size} bytes  (${detailed ? 'detailed' : 'simplified'})`);
}
