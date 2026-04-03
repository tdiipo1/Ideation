import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";

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

        // CRITICAL: Patch popup.js to replace CDN URLs with local paths
        // Transformers.js hardcodes a CDN URL for dynamic import() of the ONNX Runtime
        // Chrome MV3 blocks all external script loads, so we redirect to our local copy
        const popupJs = resolve(out, "popup.js");
        try {
          let code = readFileSync(popupJs, "utf-8");
          // Replace any CDN URL pointing to the ort mjs file with a local relative path
          code = code.replace(
            /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@[^/]+\/dist\//g,
            "./"
          );
          writeFileSync(popupJs, code);
          console.log(`Patched popup.js: CDN URLs replaced with local paths`);
        } catch (e) {
          console.warn("Could not patch popup.js:", e);
        }
      },
    },
  ],
  define: {
    "import.meta.env.VITE_EDITION": JSON.stringify(edition),
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
    include: ["onnxruntime-web", "@huggingface/transformers"],
  },
});
