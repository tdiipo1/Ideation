import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";

const edition = process.env.VITE_EDITION || "lite";
const outDir = edition === "full" ? "dist-full" : "dist-lite";
const manifestSrc = `manifests/manifest.${edition}.json`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "chrome-extension-fixup",
      writeBundle() {
        const out = resolve(__dirname, outDir);
        copyFileSync(resolve(__dirname, manifestSrc), resolve(out, "manifest.json"));

        // Copy icons (orange for lite, blue for full)
        const iconsDir = resolve(out, "icons");
        mkdirSync(iconsDir, { recursive: true });
        const iconSrc = edition === "lite" ? "public/icons-lite" : "public/icons";
        try {
          copyFileSync(resolve(__dirname, `${iconSrc}/icon16.png`), resolve(iconsDir, "icon16.png"));
          copyFileSync(resolve(__dirname, `${iconSrc}/icon48.png`), resolve(iconsDir, "icon48.png"));
          copyFileSync(resolve(__dirname, `${iconSrc}/icon128.png`), resolve(iconsDir, "icon128.png"));
        } catch {}

        // Copy ONNX Runtime files from @huggingface/transformers (matched pair)
        // These .mjs + .wasm files must come from the SAME package to avoid version mismatch
        const tfDir = resolve(__dirname, "node_modules/@huggingface/transformers/dist");
        try {
          for (const file of readdirSync(tfDir)) {
            if (file.startsWith("ort-wasm") && (file.endsWith(".wasm") || file.endsWith(".mjs"))) {
              copyFileSync(resolve(tfDir, file), resolve(out, file));
            }
          }
        } catch (e) {
          console.warn("Could not copy ORT files from transformers:", e);
        }

        // Rollup also emits the .wasm that ORT references via `new URL()` into
        // assets/. The worker sets `env.backends.onnx.wasm.wasmPaths` to the
        // extension root, so only the copies above are ever loaded; drop the
        // dead 21 MB duplicate so the package stays small.
        try {
          const assetsDir = resolve(out, "assets");
          for (const file of readdirSync(assetsDir)) {
            if (file.startsWith("ort-wasm") && (file.endsWith(".wasm") || file.endsWith(".mjs"))) {
              rmSync(resolve(assetsDir, file));
              console.log(`Removed duplicate ${file} from assets/`);
            }
          }
        } catch {}

        // CRITICAL: Patch CDN URLs to local paths in ALL output JS files.
        // Transformers.js hardcodes a CDN URL for the dynamic import() of the
        // ONNX Runtime; Chrome MV3 CSP blocks external script loads. The ORT
        // files are copied to the extension root above, so we rewrite the CDN
        // base to an absolute "/" — this resolves from the extension root no
        // matter which file (popup.js, a shared chunk, or the worker) performs
        // the import. We must scan every .js file because adding the worker
        // entry causes Rollup to split Transformers.js into shared chunks.
        const cdnRe =
          /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@[^/]+\/dist\//g;
        const patchJsInDir = (dir: string) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            if (entry.isDirectory()) {
              patchJsInDir(full);
            } else if (entry.name.endsWith(".js")) {
              const code = readFileSync(full, "utf-8");
              if (cdnRe.test(code)) {
                writeFileSync(full, code.replace(cdnRe, "/"));
                console.log(`Patched ${entry.name}: CDN URLs replaced with local paths`);
              }
            }
          }
        };
        try {
          patchJsInDir(out);
        } catch (e) {
          console.warn("Could not patch CDN URLs:", e);
        }
      },
    },
  ],
  define: {
    "import.meta.env.VITE_EDITION": JSON.stringify(edition),
  },
  // The Whisper worker is an ES module ({ type: "module" }); emit it (and its
  // chunks) as ES so imports resolve under the extension's 'self' CSP.
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        "service-worker": resolve(__dirname, "src/service-worker.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  optimizeDeps: {
    include: ["@huggingface/transformers"],
  },
});
