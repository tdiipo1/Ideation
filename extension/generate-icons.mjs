// Generate simple orange PNG icons for Ideation Lite
// Uses raw PNG encoding (no dependencies)
import { writeFileSync, mkdirSync } from "fs";

function createPNG(size, r, g, b) {
  // Create a simple solid-color square PNG with a rounded mic icon shape
  const width = size;
  const height = size;

  // Raw pixel data (RGBA)
  const pixels = new Uint8Array(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const cornerR = size * 0.19; // rounded corners

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Rounded rectangle check
      let inside = true;
      const margin = cornerR;
      if (x < margin && y < margin) {
        inside = Math.hypot(x - margin, y - margin) <= margin;
      } else if (x >= width - margin && y < margin) {
        inside = Math.hypot(x - (width - margin), y - margin) <= margin;
      } else if (x < margin && y >= height - margin) {
        inside = Math.hypot(x - margin, y - (height - margin)) <= margin;
      } else if (x >= width - margin && y >= height - margin) {
        inside = Math.hypot(x - (width - margin), y - (height - margin)) <= margin;
      }

      if (inside) {
        // Orange background
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;

        // White mic icon (simplified)
        const nx = (x - cx) / (size / 2);
        const ny = (y - cy) / (size / 2);

        // Mic body (oval)
        const micW = 0.22, micH = 0.38;
        const micY = -0.12;
        if ((nx * nx) / (micW * micW) + ((ny - micY) * (ny - micY)) / (micH * micH) <= 1) {
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
        }

        // Mic stand (line)
        if (Math.abs(nx) < 0.06 && ny > 0.26 && ny < 0.55) {
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
        }

        // Mic base
        if (Math.abs(nx) < 0.22 && ny > 0.48 && ny < 0.58) {
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
        }

        // Mic arc
        const arcR = 0.36;
        const arcDist = Math.hypot(nx, ny - 0.05);
        if (arcDist > arcR - 0.07 && arcDist < arcR + 0.02 && ny > 0.05 && ny < 0.35 && Math.abs(nx) > 0.05) {
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
        }
      } else {
        pixels[idx + 3] = 0; // transparent
      }
    }
  }

  return encodePNG(width, height, pixels);
}

function encodePNG(width, height, pixels) {
  // Minimal PNG encoder
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT - raw pixel data with filter byte per row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // no filter
    pixels.copy
      ? Buffer.from(pixels.buffer).copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
      : rawData.set(pixels.slice(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  const { deflateSync } = require_zlib();
  const compressed = deflateSync(rawData);

  const chunks = [
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ];

  return Buffer.concat([signature, ...chunks]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type);
  const crc = crc32(Buffer.concat([typeB, data]));
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc >>> 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return ~crc;
}

// Generate orange icons (F97316 = Tailwind orange-500)
const sizes = [16, 48, 128];
const outDir = "public/icons-lite";
mkdirSync(outDir, { recursive: true });

for (const size of sizes) {
  const png = createPNG(size, 249, 115, 22);
  writeFileSync(`${outDir}/icon${size}.png`, png);
  console.log(`Generated ${outDir}/icon${size}.png (${size}x${size})`);
}
