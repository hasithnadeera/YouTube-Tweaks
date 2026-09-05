/**
 * Generates PNG extension icons without third-party dependencies.
 * Geometry mirrors icons/icon.svg and is rendered with supersampling.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUTPUT_DIR = path.join(__dirname, '..', 'icons');
const DESIGN = 96;
const SUPERSAMPLE = 4;

function inRoundedRect(x, y, left, top, width, height, radius) {
  if (x < left || y < top || x > left + width || y > top + height) return false;
  const nearestX = Math.min(Math.max(x, left + radius), left + width - radius);
  const nearestY = Math.min(Math.max(y, top + radius), top + height - radius);
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

function mix(top, bottom, amount) {
  return top.map((channel, index) => channel + (bottom[index] - channel) * amount);
}

function sample(x, y) {
  if (!inRoundedRect(x, y, 2, 2, 92, 92, 22)) return null;

  let color = mix([20, 31, 61], [7, 12, 27], (x + y) / (DESIGN * 2));
  // A play triangle paired with a scrollbar: both halves of FlowPlay.
  if (x >= 25 && x <= 61 && Math.abs(y - 48) <= (61 - x) * 0.72) {
    color = mix([153, 246, 228], [34, 211, 238], y / DESIGN);
  }
  const rails = [[70, 23, 7, 50]];
  const thumbs = [[70, 39, 7, 24]];
  if (thumbs.some((shape) => inRoundedRect(x, y, ...shape, 3.5))) {
    color = mix([103, 232, 249], [45, 212, 191], x / DESIGN);
  } else if (rails.some((shape) => inRoundedRect(x, y, ...shape, 3.5))) {
    color = [49, 65, 94];
  }

  return color;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = DESIGN / (size * SUPERSAMPLE);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const color = sample(
            (px * SUPERSAMPLE + sx + 0.5) * step,
            (py * SUPERSAMPLE + sy + 0.5) * step
          );
          if (color) {
            [red, green, blue] = [red + color[0], green + color[1], blue + color[2]];
            covered += 1;
          }
        }
      }
      const offset = (py * size + px) * 4;
      pixels[offset] = covered ? Math.round(red / covered) : 0;
      pixels[offset + 1] = covered ? Math.round(green / covered) : 0;
      pixels[offset + 2] = covered ? Math.round(blue / covered) : 0;
      pixels[offset + 3] = Math.round((covered / (SUPERSAMPLE ** 2)) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  const rowSize = size * 4 + 1;
  const raw = Buffer.alloc(size * rowSize);
  for (let y = 0; y < size; y += 1) {
    raw[y * rowSize] = 0;
    pixels.copy(raw, y * rowSize + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const output = path.join(OUTPUT_DIR, `icon${size}.png`);
  fs.writeFileSync(output, encodePng(size, render(size)));
  console.log(`Generated ${path.relative(path.join(__dirname, '..'), output)} (${size}x${size})`);
}
