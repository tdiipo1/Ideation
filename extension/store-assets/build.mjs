// Builds every Chrome Web Store asset from source:
//
//   node store-assets/build.mjs            # icons + screenshots + tiles, both editions
//   node store-assets/build.mjs lite       # one edition
//   node store-assets/build.mjs --icons    # only regenerate public/icons*
//
// Icons are rasterized with sharp (already in node_modules as a dependency of
// @huggingface/transformers). Screenshots and promo tiles are HTML scenes
// (scenes.mjs) rendered by a local headless Chrome or Edge; set CHROME_PATH
// if neither is found in the usual place.
//
// Output: public/icons/, public/icons-lite/, release/store/<edition>/

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BRAND, iconSvg } from "./icon.mjs";
import { scenesFor } from "./scenes.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const args = process.argv.slice(2);
const onlyIcons = args.includes("--icons");
const editions = ["full", "lite"].filter((e) => !args.some((a) => !a.startsWith("--")) || args.includes(e));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome/Edge found. Set CHROME_PATH to the browser executable.");
  return found;
}

async function buildIcons(edition) {
  const dir = join(root, edition === "lite" ? "public/icons-lite" : "public/icons");
  mkdirSync(dir, { recursive: true });
  const svg = Buffer.from(iconSvg(BRAND[edition].color));
  for (const size of [16, 48, 128]) {
    // Rasterize at the target size (not downscaled from 128) so edges stay crisp.
    await sharp(svg, { density: 72 * (size / 128) * 4 })
      .resize(size, size)
      .png()
      .toFile(join(dir, `icon${size}.png`));
  }
  console.log(`${edition}: icons -> ${dir}`);
  return join(dir, "icon128.png");
}

async function render(chrome, profile, scene, htmlDir, outDir) {
  const htmlPath = join(htmlDir, `${scene.name}.html`);
  writeFileSync(htmlPath, scene.html);
  const out = join(outDir, `${scene.name}.png`);
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      `--window-size=${scene.width},${scene.height}`,
      "--virtual-time-budget=4000",
      `--screenshot=${out}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: "pipe" },
  );
  const meta = await sharp(out).metadata();
  const ok = meta.width === scene.width && meta.height === scene.height;
  console.log(`${scene.name}.png ${meta.width}x${meta.height}${ok ? "" : "  <-- WRONG SIZE"}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const icon128 = {};
  for (const edition of editions) icon128[edition] = await buildIcons(edition);
  if (onlyIcons) return;

  const chrome = findChrome();
  const work = mkdtempSync(join(tmpdir(), "ideation-store-"));
  const profile = join(work, "profile");
  try {
    for (const edition of editions) {
      const outDir = join(root, "release/store", edition);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      const htmlDir = join(work, edition);
      mkdirSync(htmlDir, { recursive: true });
      for (const scene of scenesFor(edition)) await render(chrome, profile, scene, htmlDir, outDir);
      await sharp(icon128[edition]).toFile(join(outDir, "icon-128.png"));
      console.log(`${edition}: store assets -> ${outDir}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
