// Whisper inference Web Worker.
//
// All model loading and transcription runs here, off the popup's main thread,
// so the UI stays responsive while live-streaming segments are transcribed
// during recording. The popup talks to this worker via postMessage (see
// useWhisper.ts) using requestId-tagged messages.

// Import ONNX Runtime explicitly so Transformers.js uses the bundled copy
// instead of dynamically importing from a CDN (blocked by Chrome MV3 CSP).
import OrtModule from "onnxruntime-web";
import { pipeline, env } from "@huggingface/transformers";

// Ensure Transformers.js picks up our bundled ORT instance.
(self as unknown as Record<string, unknown>).ort = OrtModule;
env.allowLocalModels = false;
env.useBrowserCache = true;

// The ORT wasm/mjs files are copied to the extension root by the build step.
// Resolve them from the origin root so loading works no matter where this
// worker (or its shared chunks) physically live in the bundle.
const ROOT = new URL("/", self.location.href).href;
if (OrtModule?.env?.wasm) {
  OrtModule.env.wasm.wasmPaths = ROOT;
  // Extensions aren't cross-origin isolated, so SharedArrayBuffer threading
  // is unavailable — keep ORT single-threaded.
  OrtModule.env.wasm.numThreads = 1;
}

type Device = "webgpu" | "wasm";
type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string }>;

let transcriber: Transcriber | null = null;
let currentModel: string | null = null;
let currentDevice: Device | null = null;
let warmedUp = false;

function isEnglishOnlyModel(modelId: string | null): boolean {
  if (!modelId) return false;
  return modelId.endsWith(".en") || modelId.includes("distil-whisper");
}

async function isWebGPUAvailable(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

// Build the pipeline with the fastest available backend (WebGPU, else WASM).
// Mirrors the canonical xenova/whisper-web WebGPU dtype recipe.
async function buildPipeline(model: string): Promise<void> {
  const onProgress = (p: Record<string, unknown>) =>
    self.postMessage({ type: "model-progress", payload: p });

  if (await isWebGPUAvailable()) {
    try {
      transcriber = (await pipeline("automatic-speech-recognition", model, {
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        device: "webgpu",
        progress_callback: onProgress,
      })) as unknown as Transcriber;
      currentDevice = "webgpu";
      currentModel = model;
      return;
    } catch (err) {
      self.postMessage({ type: "log", payload: `WebGPU build failed, falling back to WASM: ${String(err)}` });
    }
  }

  transcriber = (await pipeline("automatic-speech-recognition", model, {
    dtype: "q8",
    device: "wasm",
    progress_callback: onProgress,
  })) as unknown as Transcriber;
  currentDevice = "wasm";
  currentModel = model;
}

// 1s silent inference to force WebGPU shader compilation up front.
async function warmup(): Promise<void> {
  if (!transcriber || warmedUp) return;
  try {
    const silence = new Float32Array(16000);
    const opts: Record<string, unknown> = {
      chunk_length_s: 0,
      return_timestamps: false,
      num_beams: 1,
      do_sample: false,
    };
    if (!isEnglishOnlyModel(currentModel)) {
      opts.language = "english";
      opts.task = "transcribe";
    }
    await transcriber(silence, opts);
  } catch {
    /* non-fatal */
  } finally {
    warmedUp = true;
  }
}

async function runInference(audio: Float32Array): Promise<string> {
  if (!transcriber) throw new Error("Model not loaded");
  const durationSec = audio.length / 16000;
  // Clips <= 28s use a single encoder pass (chunk_length_s: 0).
  const chunkConfig: Record<string, unknown> =
    durationSec <= 28 ? { chunk_length_s: 0 } : { chunk_length_s: 30, stride_length_s: 5 };
  const opts: Record<string, unknown> = {
    ...chunkConfig,
    return_timestamps: false,
    num_beams: 1,
    do_sample: false,
  };
  if (!isEnglishOnlyModel(currentModel)) {
    opts.language = "english";
    opts.task = "transcribe";
  }
  const result = await transcriber(audio, opts);
  return result.text;
}

// On failure (e.g. a stale WebGPU context), rebuild the pipeline once and retry.
async function runInferenceWithRetry(audio: Float32Array): Promise<string> {
  try {
    return await runInference(audio);
  } catch (err) {
    self.postMessage({ type: "log", payload: `Inference failed, rebuilding pipeline: ${String(err)}` });
    try {
      (transcriber as unknown as { dispose?: () => Promise<void> })?.dispose?.();
    } catch {
      /* ignore */
    }
    transcriber = null;
    warmedUp = false;
    if (!currentModel) throw err;
    await buildPipeline(currentModel);
    return await runInference(audio);
  }
}

// Serialize inference so two requests never run concurrently against the
// single pipeline instance.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => {},
    () => {},
  );
  return run as Promise<T>;
}

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case "load": {
      const { model } = payload;
      if (transcriber && currentModel === model) {
        self.postMessage({ type: "model-ready", payload: { device: currentDevice } });
        return;
      }
      try {
        self.postMessage({ type: "model-loading", payload: { model } });
        await buildPipeline(model);
        warmedUp = false;
        self.postMessage({ type: "model-ready", payload: { device: currentDevice } });
        warmup();
      } catch (err) {
        self.postMessage({ type: "model-error", payload: String(err) });
      }
      break;
    }

    case "transcribe":
    case "transcribe-segment": {
      const { audio, requestId } = payload;
      if (!transcriber) {
        self.postMessage({ type: "error", payload: { requestId, message: "Model not loaded" } });
        return;
      }
      enqueue(() => runInferenceWithRetry(audio as Float32Array))
        .then((text) => self.postMessage({ type: "result", payload: { requestId, text } }))
        .catch((err) =>
          self.postMessage({ type: "error", payload: { requestId, message: String(err) } }),
        );
      break;
    }
  }
};
