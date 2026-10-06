#!/usr/bin/env node
// Bench / spike harness for the extension's Whisper setup, run in Node with
// the same @huggingface/transformers build the worker uses.
//
//   node scripts/bench.mjs <file.wav> [--model onnx-community/whisper-base]
//        [--language auto|en|es|zh] [--ref transcript.txt] [--prompt "prev text"]
//        [--dtype q8|fp32] [--pipeline]
//
// - Prints the transcript, elapsed time, and (with --ref) word/char error
//   rates against a hand-typed reference.
// - `--language auto` runs the same one-token language detection the worker
//   uses (spike S3).
// - `--prompt` conditions the decoder on previous text through
//   <|startofprev|> exactly like the worker's (flag-gated) context path, so
//   repetition loops can be checked before enabling it (spike S2).
// - `--pipeline` uses the stock pipeline call instead of the direct generate
//   path, for A/B comparisons.
//
// WAV input: PCM16 or float32, mono or stereo, any sample rate (resampled
// linearly to 16 kHz). Models are cached under extension/.cache.

import { readFileSync } from "fs";
import { pipeline, env, LogitsProcessor, LogitsProcessorList } from "@huggingface/transformers";

env.cacheDir = new URL("../.cache/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith("--")) {
  console.error("usage: node scripts/bench.mjs <file.wav> [--model id] [--language auto|xx] [--ref file] [--prompt text] [--dtype q8|fp32] [--pipeline]");
  process.exit(1);
}
const wavPath = args[0];
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const modelId = opt("--model", "onnx-community/whisper-base");
const language = opt("--language", "auto");
const refPath = opt("--ref", null);
const prompt = opt("--prompt", null);
const dtype = opt("--dtype", "q8");
const usePipeline = args.includes("--pipeline");

// ---- WAV decoding --------------------------------------------------------
function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = buf.subarray(pos + 8, pos + 8 + size);
    if (id === "fmt ") {
      fmt = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        rate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === "data") {
      data = body;
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("missing fmt/data chunk");
  const frames = data.length / (fmt.channels * (fmt.bits / 8));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const idx = (i * fmt.channels + c) * (fmt.bits / 8);
      let v;
      if (fmt.format === 3) v = data.readFloatLE(idx);
      else if (fmt.bits === 16) v = data.readInt16LE(idx) / 32768;
      else if (fmt.bits === 32) v = data.readInt32LE(idx) / 2147483648;
      else if (fmt.bits === 24) v = ((data[idx] | (data[idx + 1] << 8) | (data[idx + 2] << 16)) << 8 >> 8) / 8388608;
      else if (fmt.bits === 8) v = (data[idx] - 128) / 128;
      else throw new Error(`unsupported bit depth ${fmt.bits}`);
      sum += v;
    }
    mono[i] = sum / fmt.channels;
  }
  return { audio: resampleLinear(mono, fmt.rate, 16000), rate: fmt.rate };
}

function resampleLinear(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (x - i0);
  }
  return out;
}

// ---- Error rates ---------------------------------------------------------
function editDistance(a, b) {
  const dp = new Array(b.length + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
function errorRates(hyp, ref) {
  const hw = norm(hyp).split(" ").filter(Boolean);
  const rw = norm(ref).split(" ").filter(Boolean);
  const wer = rw.length ? editDistance(hw, rw) / rw.length : NaN;
  const hc = [...norm(hyp).replace(/\s/g, "")];
  const rc = [...norm(ref).replace(/\s/g, "")];
  const cer = rc.length ? editDistance(hc, rc) / rc.length : NaN;
  return { wer, cer };
}

// ---- Model paths (same as the worker) -------------------------------------
class OnlyTokens extends LogitsProcessor {
  constructor(allowed) {
    super();
    this.allowed = allowed;
  }
  _call(input_ids, logits) {
    const vocab = logits.dims[logits.dims.length - 1];
    const data = logits.data;
    for (let b = 0; b < input_ids.length; b++) {
      const base = b * vocab;
      for (let t = 0; t < vocab; t++) if (!this.allowed.has(t)) data[base + t] = -Infinity;
    }
    return logits;
  }
}

async function detectLanguage(asr, audio) {
  const g = asr.model.generation_config;
  if (!g.is_multilingual || !g.lang_to_id) return null;
  const idToCode = new Map(Object.entries(g.lang_to_id).map(([tok, id]) => [id, tok.slice(2, -2)]));
  const { input_features } = await asr.processor(audio.subarray(0, 16000 * 30));
  const lp = new LogitsProcessorList();
  lp.push(new OnlyTokens(new Set(idToCode.keys())));
  const out = await asr.model.generate({
    inputs: input_features,
    decoder_input_ids: [g.decoder_start_token_id],
    max_new_tokens: 1,
    logits_processor: lp,
  });
  const seq = out.tolist()[0];
  return idToCode.get(Number(seq[1])) ?? null;
}

async function transcribeDirect(asr, audio, lang, prevText) {
  const g = asr.model.generation_config;
  const { input_features } = await asr.processor(audio);
  const init = [];
  if (prevText && g.prev_sot_token_id != null) {
    const ids = asr.tokenizer.encode(" " + prevText.trim(), { add_special_tokens: false });
    init.push(g.prev_sot_token_id, ...ids.slice(-64));
  }
  init.push(g.decoder_start_token_id);
  if (g.is_multilingual && g.lang_to_id) {
    init.push(g.lang_to_id[`<|${lang ?? "en"}|>`] ?? g.lang_to_id["<|en|>"], g.task_to_id.transcribe);
  }
  if (g.no_timestamps_token_id != null) init.push(g.no_timestamps_token_id);
  const out = await asr.model.generate({ inputs: input_features, decoder_input_ids: init, max_new_tokens: 256 });
  const ids = out.tolist()[0].slice(init.length).map(Number);
  return asr.tokenizer.decode(ids, { skip_special_tokens: true }).trim();
}

// ---- Main ----------------------------------------------------------------
const { audio, rate } = readWav(wavPath);
const secs = audio.length / 16000;
console.log(`audio: ${wavPath} (${rate} Hz → 16 kHz, ${secs.toFixed(1)} s)`);

const t0 = performance.now();
const asr = await pipeline("automatic-speech-recognition", modelId, { dtype });
console.log(`model: ${modelId} dtype=${dtype} loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const multilingual = !!asr.model.generation_config?.is_multilingual;

let lang = multilingual ? (language === "auto" ? null : language) : null;
if (multilingual && language === "auto") {
  const t1 = performance.now();
  lang = await detectLanguage(asr, audio);
  console.log(`detected language: ${lang} (${((performance.now() - t1) / 1000).toFixed(2)} s)`);
}

const t2 = performance.now();
let text;
if (usePipeline || secs > 28) {
  const opts = secs > 28 ? { chunk_length_s: 30, stride_length_s: 5 } : { chunk_length_s: 0 };
  if (multilingual) Object.assign(opts, { language: lang ?? "en", task: "transcribe" });
  text = (await asr(audio, opts)).text.trim();
} else {
  text = await transcribeDirect(asr, audio, lang, prompt);
}
const dt = (performance.now() - t2) / 1000;
console.log(`decode: ${dt.toFixed(2)} s (${(dt / secs).toFixed(2)}x realtime)${prompt ? " [prompted]" : ""}`);
console.log(`TEXT: ${text}`);
if (refPath) {
  const ref = readFileSync(refPath, "utf8");
  const { wer, cer } = errorRates(text, ref);
  console.log(`WER: ${(wer * 100).toFixed(1)}%  CER: ${(cer * 100).toFixed(1)}%`);
}
