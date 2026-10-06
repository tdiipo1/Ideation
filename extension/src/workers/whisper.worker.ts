// Whisper inference Web Worker.
//
// All model loading and transcription runs here, off the popup's main thread,
// so the UI stays responsive while live-streaming segments are transcribed
// during recording. The popup talks to this worker via postMessage (see
// useWhisper.ts) using requestId-tagged messages.
//
// Language handling: a "session" is one recording. With a multilingual model
// and the "auto" setting, each segment is run through a one-token language
// detection step until a segment with enough speech comes along; its language
// is then locked for the rest of the session. (Transformers.js has no built-in
// detection and would otherwise decode everything as English.) English-only
// models never detect.

import {
  pipeline,
  env,
  LogitsProcessor,
  LogitsProcessorList,
  WhisperTextStreamer,
  Tensor,
} from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

// ONNX Runtime config. Transformers.js bundles its own onnxruntime-web and
// exposes its env as `env.backends.onnx` — that is the only copy that runs.
// The .wasm/.mjs files are copied to the extension root by the build step.
const ROOT = new URL("/", self.location.href).href;
const COI = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
const HARDWARE = navigator.hardwareConcurrency || 2;
// WASM threads need SharedArrayBuffer, i.e. a cross-origin-isolated page
// (the manifest's COOP/COEP keys). Without it ORT runs single-threaded.
const THREADS = COI ? Math.min(8, Math.max(2, HARDWARE - 1)) : 1;
const onnxEnv = (env.backends as unknown as {
  onnx?: { wasm?: { wasmPaths?: unknown; numThreads?: number } };
}).onnx;
if (onnxEnv?.wasm) {
  onnxEnv.wasm.wasmPaths = ROOT;
  onnxEnv.wasm.numThreads = THREADS;
}

type Device = "webgpu" | "wasm";
// The ASR pipeline object: callable, and it exposes the loaded parts.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Pipeline = {
  (audio: Float32Array, opts: Record<string, unknown>): Promise<{ text: string }>;
  model: any;
  processor: any;
  tokenizer: any;
  dispose?: () => Promise<void>;
};

let transcriber: Pipeline | null = null;
let currentModel: string | null = null;
let currentDevice: Device | null = null;
let warmedUp = false;

// Per-recording language state.
let sessionSetting = "auto";
let lockedLanguage: string | null = null;
let announcedLanguage: string | null = null;

/** Voiced seconds a segment needs before its detected language is locked. */
const LOCK_MIN_VOICED_SECS = 2;
/** Clips up to this length go through a single encoder pass. */
const MAX_DIRECT_SECS = 28;
const SAMPLE_RATE = 16000;

function post(type: string, payload?: unknown): void {
  self.postMessage({ type, payload });
}

function log(message: string): void {
  post("log", message);
}

function genConfig(): any {
  return transcriber?.model?.generation_config ?? {};
}

function isMultilingual(): boolean {
  const g = genConfig();
  return !!g.is_multilingual && !!g.lang_to_id;
}

function isValidLanguage(code: string | null): code is string {
  return !!code && !!genConfig().lang_to_id?.[`<|${code}|>`];
}

/** Language the session is committed to; "en" for English-only models. */
function effectiveLanguage(): string | null {
  if (!transcriber) return null;
  if (!isMultilingual()) return "en";
  return lockedLanguage;
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
// Mirrors the canonical xenova/whisper-web WebGPU dtype recipe (fp32 encoder:
// fp16 encoders have known precision issues on some GPUs).
async function buildPipeline(model: string): Promise<void> {
  const onProgress = (p: Record<string, unknown>) => post("model-progress", p);

  if (transcriber) {
    try {
      await transcriber.dispose?.();
    } catch {
      /* ignore */
    }
    transcriber = null;
  }

  if (await isWebGPUAvailable()) {
    try {
      transcriber = (await pipeline("automatic-speech-recognition", model, {
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        device: "webgpu",
        progress_callback: onProgress,
      })) as unknown as Pipeline;
      currentDevice = "webgpu";
      currentModel = model;
      return;
    } catch (err) {
      log(`WebGPU build failed, falling back to WASM: ${String(err)}`);
    }
  }

  transcriber = (await pipeline("automatic-speech-recognition", model, {
    dtype: "q8",
    device: "wasm",
    progress_callback: onProgress,
  })) as unknown as Pipeline;
  currentDevice = "wasm";
  currentModel = model;
}

// 1s silent inference to force WebGPU shader compilation up front.
async function warmup(): Promise<void> {
  if (!transcriber || warmedUp) return;
  try {
    await transcribePipeline(new Float32Array(SAMPLE_RATE), "en");
  } catch {
    /* non-fatal */
  } finally {
    warmedUp = true;
  }
}

/** Masks every logit except the allowed token ids (used for language detection). */
class OnlyTokens extends LogitsProcessor {
  private allowed: Set<number>;
  constructor(allowed: Set<number>) {
    super();
    this.allowed = allowed;
  }
  _call(input_ids: bigint[][], logits: Tensor): Tensor {
    const vocab = logits.dims[logits.dims.length - 1];
    const data = logits.data as Float32Array;
    for (let b = 0; b < input_ids.length; b++) {
      const base = b * vocab;
      for (let t = 0; t < vocab; t++) {
        if (!this.allowed.has(t)) data[base + t] = -Infinity;
      }
    }
    return logits;
  }
}

/**
 * One decoder step after <|startoftranscript|> with only language tokens
 * allowed: the chosen token *is* the detected language. Costs one encoder
 * pass, so it runs only until the session locks.
 */
async function detectLanguage(audio: Float32Array): Promise<string | null> {
  if (!transcriber || !isMultilingual()) return null;
  const { model, processor } = transcriber;
  const g = genConfig();
  const idToCode = new Map<number, string>();
  for (const [tok, id] of Object.entries(g.lang_to_id as Record<string, number>)) {
    idToCode.set(id, tok.slice(2, -2));
  }
  const clip = audio.length > SAMPLE_RATE * 30 ? audio.subarray(0, SAMPLE_RATE * 30) : audio;
  const { input_features } = await processor(clip);
  const lp = new LogitsProcessorList();
  lp.push(new OnlyTokens(new Set(idToCode.keys())));
  const out = (await model.generate({
    inputs: input_features,
    decoder_input_ids: [g.decoder_start_token_id],
    max_new_tokens: 1,
    logits_processor: lp,
  })) as Tensor;
  const seq = (out.tolist() as (bigint | number)[][])[0];
  if (!seq || seq.length < 2) return null;
  return idToCode.get(Number(seq[1])) ?? null;
}

/**
 * Direct generate path (≤ 28 s clips): we build the decoder prefix ourselves
 * so the language token is exact and tokens can be streamed to the UI as
 * they are decoded. The pipeline remains the loader and the >28 s fallback.
 */
async function transcribeDirect(
  audio: Float32Array,
  language: string | null,
  onPartial?: (text: string) => void,
): Promise<string> {
  if (!transcriber) throw new Error("Model not loaded");
  const { model, processor, tokenizer } = transcriber;
  const g = genConfig();
  const { input_features } = await processor(audio);

  const init: number[] = [g.decoder_start_token_id];
  if (isMultilingual()) {
    const langId = g.lang_to_id[`<|${language ?? "en"}|>`] ?? g.lang_to_id["<|en|>"];
    init.push(langId, g.task_to_id?.transcribe);
  }
  if (g.no_timestamps_token_id != null) init.push(g.no_timestamps_token_id);

  const kwargs: Record<string, unknown> = {
    inputs: input_features,
    decoder_input_ids: init,
    max_new_tokens: 256,
  };
  if (onPartial) {
    let streamed = "";
    kwargs.streamer = new WhisperTextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (t: string) => {
        streamed += t;
        onPartial(streamed);
      },
    });
  }

  const out = (await model.generate(kwargs)) as Tensor;
  const seq = (out.tolist() as (bigint | number)[][])[0] ?? [];
  const ids = seq.slice(init.length).map((x) => Number(x));
  return String(tokenizer.decode(ids, { skip_special_tokens: true })).trim();
}

/** Pipeline path: chunked decoding for long clips and the warmup. */
async function transcribePipeline(audio: Float32Array, language: string | null): Promise<string> {
  if (!transcriber) throw new Error("Model not loaded");
  const durationSec = audio.length / SAMPLE_RATE;
  const opts: Record<string, unknown> =
    durationSec <= MAX_DIRECT_SECS
      ? { chunk_length_s: 0 }
      : { chunk_length_s: 30, stride_length_s: 5 };
  opts.return_timestamps = false;
  opts.num_beams = 1;
  opts.do_sample = false;
  if (isMultilingual()) {
    opts.language = language ?? "en";
    opts.task = "transcribe";
  }
  const result = await transcriber(audio, opts);
  return result.text.trim();
}

async function runInference(
  audio: Float32Array,
  language: string | null,
  onPartial?: (text: string) => void,
): Promise<string> {
  if (audio.length / SAMPLE_RATE <= MAX_DIRECT_SECS) {
    try {
      return await transcribeDirect(audio, language, onPartial);
    } catch (err) {
      log(`Direct generate failed, using pipeline: ${String(err)}`);
    }
  }
  return transcribePipeline(audio, language);
}

// On failure (e.g. a stale WebGPU context), rebuild the pipeline once and retry.
async function runInferenceWithRetry(
  audio: Float32Array,
  language: string | null,
  onPartial?: (text: string) => void,
): Promise<string> {
  try {
    return await runInference(audio, language, onPartial);
  } catch (err) {
    log(`Inference failed, rebuilding pipeline: ${String(err)}`);
    warmedUp = false;
    if (!currentModel) throw err;
    await buildPipeline(currentModel);
    return await runInference(audio, language, onPartial);
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

function announceLockedLanguage(): void {
  if (!isMultilingual() || !lockedLanguage) return;
  if (announcedLanguage === lockedLanguage) return;
  announcedLanguage = lockedLanguage;
  post("language-detected", { code: lockedLanguage });
}

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case "load": {
      const { model } = payload;
      if (transcriber && currentModel === model) {
        post("model-ready", {
          model,
          device: currentDevice,
          multilingual: isMultilingual(),
          threads: THREADS,
          crossOriginIsolated: COI,
        });
        return;
      }
      try {
        post("model-loading", { model });
        await buildPipeline(model);
        warmedUp = false;
        log(`model=${model} device=${currentDevice} coi=${COI} threads=${THREADS}`);
        post("model-ready", {
          model,
          device: currentDevice,
          multilingual: isMultilingual(),
          threads: THREADS,
          crossOriginIsolated: COI,
        });
        warmup();
      } catch (err) {
        post("model-error", { model, message: String(err) });
      }
      break;
    }

    case "session-start": {
      sessionSetting = (payload && payload.language) || "auto";
      lockedLanguage = null;
      announcedLanguage = null;
      break;
    }

    case "transcribe":
    case "transcribe-segment": {
      const { audio, requestId, voicedSecs = 0, wantPartial = false } = payload;
      if (!transcriber) {
        post("error", { requestId, message: "Model not loaded" });
        return;
      }
      enqueue(async () => {
        let language = effectiveLanguage();
        if (isMultilingual() && !lockedLanguage) {
          if (sessionSetting !== "auto" && isValidLanguage(sessionSetting)) {
            lockedLanguage = sessionSetting;
            language = sessionSetting;
          } else {
            const code = await detectLanguage(audio as Float32Array);
            if (code) {
              language = code;
              if (voicedSecs >= LOCK_MIN_VOICED_SECS) lockedLanguage = code;
            }
          }
        }
        announceLockedLanguage();
        const onPartial = wantPartial
          ? (text: string) => post("partial", { requestId, text })
          : undefined;
        const text = await runInferenceWithRetry(audio as Float32Array, language, onPartial);
        return { text, language: language ?? effectiveLanguage() };
      })
        .then((r) => post("result", { requestId, text: r.text, language: r.language }))
        .catch((err) => post("error", { requestId, message: String(err) }));
      break;
    }
  }
};
