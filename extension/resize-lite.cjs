const { readFileSync, writeFileSync, readdirSync, mkdirSync } = require("fs");
const { deflateSync } = require("zlib");
const path = require("path");

// Decode a PNG file into raw RGBA pixels
function decodePNG(buffer) {
  // Minimal PNG decoder - extract IHDR and IDAT
  let pos = 8; // skip signature
  let width, height, bitDepth, colorType;
  const idatChunks = [];

  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.slice(pos + 8, pos + 8 + len);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }

  const { inflateSync } = require("zlib");
  const compressed = Buffer.concat(idatChunks);
  const raw = inflateSync(compressed);

  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 4;
  const pixels = Buffer.alloc(width * height * 4);

  // Unfilter
  const stride = width * bpp;
  let rawPos = 0;
  const scanlines = [];

  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const line = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      let val = raw[rawPos++];
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = y > 0 ? scanlines[y - 1][x] : 0;
      const c = (x >= bpp && y > 0) ? scanlines[y - 1][x - bpp] : 0;

      switch (filter) {
        case 0: break;
        case 1: val = (val + a) & 0xFF; break;
        case 2: val = (val + b) & 0xFF; break;
        case 3: val = (val + Math.floor((a + b) / 2)) & 0xFF; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val = (val + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
          break;
        }
      }
      line[x] = val;
    }
    scanlines.push(line);

    // Convert to RGBA
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      if (bpp === 4) {
        pixels[pi] = line[x * 4];
        pixels[pi + 1] = line[x * 4 + 1];
        pixels[pi + 2] = line[x * 4 + 2];
        pixels[pi + 3] = line[x * 4 + 3];
      } else {
        pixels[pi] = line[x * 3];
        pixels[pi + 1] = line[x * 3 + 1];
        pixels[pi + 2] = line[x * 3 + 2];
        pixels[pi + 3] = 255;
      }
    }
  }

  return { width, height, pixels };
}

function encodePNG(w, h, px) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // RGB, no alpha (Chrome requirement)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = y * (1 + w * 3) + 1 + x * 3;
      raw[di] = px[si];
      raw[di + 1] = px[si + 1];
      raw[di + 2] = px[si + 2];
    }
  }
  const compressed = deflateSync(raw);

  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const c = crc32(Buffer.concat([t, data]));
  const cb = Buffer.alloc(4); cb.writeUInt32BE(c >>> 0);
  return Buffer.concat([len, t, data, cb]);
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); }
  return ~c;
}

// Main
const srcDir = "release/Lite SS";
const outDir = "release/screenshots-lite";
mkdirSync(outDir, { recursive: true });

const TARGET_W = 1280;
const TARGET_H = 800;

const files = readdirSync(srcDir).filter(f => f.endsWith(".png")).sort();

files.forEach((file, i) => {
  console.log(`Processing ${file}...`);
  const src = decodePNG(readFileSync(path.join(srcDir, file)));

  // Create canvas with dark background
  const canvas = Buffer.alloc(TARGET_W * TARGET_H * 4);
  // Fill with dark gray (#1a1a1a)
  for (let p = 0; p < TARGET_W * TARGET_H; p++) {
    canvas[p * 4] = 26;
    canvas[p * 4 + 1] = 26;
    canvas[p * 4 + 2] = 26;
    canvas[p * 4 + 3] = 255;
  }

  // Center the screenshot on the canvas
  const offsetX = Math.floor((TARGET_W - src.width) / 2);
  const offsetY = Math.floor((TARGET_H - src.height) / 2);

  for (let y = 0; y < src.height && (y + offsetY) < TARGET_H; y++) {
    for (let x = 0; x < src.width && (x + offsetX) < TARGET_W; x++) {
      const srcIdx = (y * src.width + x) * 4;
      const dstX = x + offsetX;
      const dstY = y + offsetY;
      if (dstX >= 0 && dstY >= 0) {
        const dstIdx = (dstY * TARGET_W + dstX) * 4;
        const alpha = src.pixels[srcIdx + 3] / 255;
        canvas[dstIdx] = Math.round(src.pixels[srcIdx] * alpha + canvas[dstIdx] * (1 - alpha));
        canvas[dstIdx + 1] = Math.round(src.pixels[srcIdx + 1] * alpha + canvas[dstIdx + 1] * (1 - alpha));
        canvas[dstIdx + 2] = Math.round(src.pixels[srcIdx + 2] * alpha + canvas[dstIdx + 2] * (1 - alpha));
        canvas[dstIdx + 3] = 255;
      }
    }
  }

  const out = encodePNG(TARGET_W, TARGET_H, canvas);
  const outPath = path.join(outDir, `screenshot-lite-${i + 1}.png`);
  writeFileSync(outPath, out);
  console.log(`  -> ${outPath} (${TARGET_W}x${TARGET_H})`);
});

console.log("Done!");
