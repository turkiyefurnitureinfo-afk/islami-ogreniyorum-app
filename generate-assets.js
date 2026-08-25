/**
 * Generate placeholder PNG assets (icon, adaptive icon, splash, favicon)
 * using Node.js built-in zlib - no external dependencies needed.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Create a minimal valid PNG file.
 */
function createPNG(width, height, getPixel) {
  const header = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Build raw pixel data with filter byte 0 for each row
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const compressed = zlib.deflateSync(raw);

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([length, typeBuf, data, crc]);
  }

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

// Colors
const DARK_TEAL = [8, 19, 26, 255];
const GOLD = [216, 181, 106, 255];

// App icon: gold crescent on dark teal background
function iconPixel(x, y) {
  const cx1 = 528, cy1 = 456, r1 = 200;
  const cx2 = 608, cy2 = 456, r2 = 200;
  const cx3 = 528, cy3 = 528, r3 = 50;
  const inOuter = (x - cx1) * (x - cx1) + (y - cy1) * (y - cy1) <= r1 * r1;
  const inInner = (x - cx2) * (x - cx2) + (y - cy2) * (y - cy2) <= r2 * r2;
  const inStar = (x - cx3) * (x - cx3) + (y - cy3) * (y - cy3) <= r3 * r3;
  if ((inOuter && !inInner) || inStar) return GOLD;
  return DARK_TEAL;
}

// Adaptive icon: gold crescent, transparent background
function adaptivePixel(x, y) {
  const cx1 = 512, cy1 = 512, r1 = 180;
  const cx2 = 592, cy2 = 512, r2 = 180;
  const inOuter = (x - cx1) * (x - cx1) + (y - cy1) * (y - cy1) <= r1 * r1;
  const inInner = (x - cx2) * (x - cx2) + (y - cy2) * (y - cy2) <= r2 * r2;
  if (inOuter && !inInner) return GOLD;
  return [0, 0, 0, 0];
}

// Splash: larger gold crescent on dark teal
function splashPixel(x, y) {
  const cx1 = 1024, cy1 = 1024, r1 = 280;
  const cx2 = 1130, cy2 = 1024, r2 = 280;
  const inOuter = (x - cx1) * (x - cx1) + (y - cy1) * (y - cy1) <= r1 * r1;
  const inInner = (x - cx2) * (x - cx2) + (y - cy2) * (y - cy2) <= r2 * r2;
  if (inOuter && !inInner) return GOLD;
  return DARK_TEAL;
}

// Favicon
function faviconPixel(x, y) {
  const cx1 = 24, cy1 = 22, r1 = 14;
  const cx2 = 29, cy2 = 22, r2 = 14;
  const inOuter = (x - cx1) * (x - cx1) + (y - cy1) * (y - cy1) <= r1 * r1;
  const inInner = (x - cx2) * (x - cx2) + (y - cy2) * (y - cy2) <= r2 * r2;
  if (inOuter && !inInner) return GOLD;
  return DARK_TEAL;
}

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

const assets = [
  ['icon.png', 1024, 1024, iconPixel],
  ['adaptive-icon.png', 1024, 1024, adaptivePixel],
  ['splash.png', 2048, 2048, splashPixel],
  ['favicon.png', 48, 48, faviconPixel],
];

for (const [name, w, h, pixelFn] of assets) {
  const png = createPNG(w, h, pixelFn);
  const filePath = path.join(assetsDir, name);
  fs.writeFileSync(filePath, png);
  console.log('Created: ' + filePath + ' (' + png.length + ' bytes)');
}

console.log('All assets generated successfully.');