const { writeFileSync, mkdirSync } = require("fs");
const { deflateSync } = require("zlib");

function createPNG(size, r, g, b) {
  const width = size, height = size;
  const pixels = Buffer.alloc(width * height * 4);
  const cx = width / 2, cy = height / 2;
  const cornerR = size * 0.19;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let inside = true;
      const m = cornerR;
      if (x < m && y < m) inside = Math.hypot(x - m, y - m) <= m;
      else if (x >= width - m && y < m) inside = Math.hypot(x - (width - m), y - m) <= m;
      else if (x < m && y >= height - m) inside = Math.hypot(x - m, y - (height - m)) <= m;
      else if (x >= width - m && y >= height - m) inside = Math.hypot(x - (width - m), y - (height - m)) <= m;

      if (inside) {
        pixels[idx] = r; pixels[idx+1] = g; pixels[idx+2] = b; pixels[idx+3] = 255;
        const nx = (x - cx) / (size/2), ny = (y - cy) / (size/2);
        // Mic body
        if ((nx*nx)/0.048 + ((ny+0.12)*(ny+0.12))/0.144 <= 1) {
          pixels[idx]=255; pixels[idx+1]=255; pixels[idx+2]=255;
        }
        // Stand
        if (Math.abs(nx)<0.06 && ny>0.26 && ny<0.55) {
          pixels[idx]=255; pixels[idx+1]=255; pixels[idx+2]=255;
        }
        // Base
        if (Math.abs(nx)<0.22 && ny>0.48 && ny<0.58) {
          pixels[idx]=255; pixels[idx+1]=255; pixels[idx+2]=255;
        }
        // Arc
        const d = Math.hypot(nx, ny-0.05);
        if (d>0.29 && d<0.38 && ny>0.05 && ny<0.35 && Math.abs(nx)>0.05) {
          pixels[idx]=255; pixels[idx+1]=255; pixels[idx+2]=255;
        }
      } else {
        pixels[idx+3] = 0;
      }
    }
  }
  return encodePNG(width, height, pixels);
}

function encodePNG(w, h, px) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

  const raw = Buffer.alloc(h*(1+w*4));
  for (let y=0;y<h;y++) {
    raw[y*(1+w*4)]=0;
    px.copy(raw, y*(1+w*4)+1, y*w*4, (y+1)*w*4);
  }
  const compressed = deflateSync(raw);

  return Buffer.concat([sig, chunk("IHDR",ihdr), chunk("IDAT",compressed), chunk("IEND",Buffer.alloc(0))]);
}

function chunk(type, data) {
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t=Buffer.from(type);
  const c=crc32(Buffer.concat([t,data]));
  const cb=Buffer.alloc(4); cb.writeUInt32BE(c>>>0);
  return Buffer.concat([len,t,data,cb]);
}

function crc32(buf) {
  let c=0xFFFFFFFF;
  for(let i=0;i<buf.length;i++){c^=buf[i];for(let j=0;j<8;j++)c=(c>>>1)^(c&1?0xEDB88320:0);}
  return ~c;
}

mkdirSync("public/icons-lite", {recursive:true});
for (const s of [16,48,128]) {
  writeFileSync(`public/icons-lite/icon${s}.png`, createPNG(s, 249, 115, 22));
  console.log(`Generated icon${s}.png`);
}
