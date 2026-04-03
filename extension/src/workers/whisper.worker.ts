// Import ONNX Runtime explicitly so Transformers.js uses the bundled copy
// instead of trying to dynamically import from CDN (which Chrome CSP blocks)
import OrtModule from "onnxruntime-web";
import { pipeline, env } from "@huggingface/transformers";

// Configure Transformers.js for Chrome extension environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// Point ONNX Runtime WASM to the bundled files in our extension
// The WASM binary is already in our build output under assets/
const wasmDir = /* @vite-ignore */ new URL("./", import.meta.url).href;
if (OrtModule?.env?.wasm) {
  OrtModule.env.wasm.wasmPaths = wasmDir;
}

let transcriber: Awaited<ReturnType<typeof pipeline>> | null = null;
let currentModel: string | null = null;

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case "load": {
      const { model } = payload;
      if (transcriber && currentModel === model) {
        self.postMessage({ type: "model-ready" });
        return;
      }
      try {
        self.postMessage({ type: "model-loading", payload: { model } });
        transcriber = await pipeline("automatic-speech-recognition", model, {
          dtype: "q8",
          device: "wasm",
          progress_callback: (progress: Record<string, unknown>) => {
            self.postMessage({ type: "model-progress", payload: progress });
          },
        });
        currentModel = model;
        self.postMessage({ type: "model-ready" });
      } catch (err) {
        self.postMessage({ type: "model-error", payload: String(err) });
      }
      break;
    }

    case "transcribe": {
      if (!transcriber) {
        self.postMessage({ type: "error", payload: "Model not loaded" });
        return;
      }
      try {
        self.postMessage({ type: "transcribing" });
        const result = await (transcriber as CallableFunction)(payload.audio, {
          language: "english",
          task: "transcribe",
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: false,
        });
        self.postMessage({
          type: "transcript",
          payload: { text: (result as { text: string }).text },
        });
      } catch (err) {
        self.postMessage({ type: "error", payload: String(err) });
      }
      break;
    }
  }
};
