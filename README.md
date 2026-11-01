# Ideation

**Voice-to-prompt tool.** Press a button, talk in your language, get clean text. That's it.

Ideation captures your spoken thoughts and turns them into structured, ready-to-use text. Built for people who think by talking. Everything runs on your device: the speech model is OpenAI's Whisper, executed locally.

## How It Works

1. **Record** - Click the mic or press the shortcut. Captions appear while you speak.
2. **Transcribe** - Whisper runs locally (nothing leaves your device). The spoken language is detected on the first seconds of each recording and locked for the rest of it, or you pin one in Settings.
3. **Clean up** - Filler words removed, stutters collapsed, capitalization fixed, Whisper artifacts dropped. Language-aware (English, Spanish, Portuguese, French, German, Chinese, Japanese have their own filler lists; Chinese/Japanese/Thai text is joined without spaces).
4. **Smart correction** (optional) - An LLM fixes words that were clearly misheard given the sentence context, without changing anything else. Local Ollama on desktop; your chosen provider in the extension.
5. **Structure** - Optionally restructure into an organized prompt with one click (same language as the transcript).
6. **Use** - Copy and paste anywhere; the desktop app can auto-paste.

The interface is available in English, Spanish and Simplified Chinese (follows the browser/system language; the desktop app has an override).

## Products

### Chrome Extension

Two editions from one codebase:

| | Ideation Lite | Ideation |
|---|---|---|
| Record + Transcribe, live captions | Yes | Yes |
| Language auto-detect (99 languages with a multilingual model) | Yes | Yes |
| Copy to clipboard / Insert into page | Yes | Yes |
| Transcript healing | - | Yes |
| Smart correction (opt-in, LLM) | - | Yes |
| History | - | Yes |
| Prompt structuring | - | Yes (Gemini free) |
| Settings (model, language, provider) | - | Yes |
| Side Panel UI | Yes | Yes |

**Install from the Chrome Web Store:** [Ideation](https://chromewebstore.google.com/detail/jhdhkbceipidnhfolikdpmopghgkicjo?utm_source=github&utm_medium=readme) · [Ideation Lite](https://chromewebstore.google.com/detail/ideation-lite/pmanijfhocbgdafgamjnhdgojennegmm?utm_source=github&utm_medium=readme)

Models offered in the extension (downloaded once from Hugging Face, cached in the browser):

| Model | Download | Languages | When to use |
|---|---|---|---|
| Tiny (English) | 40–120 MB | English | Default on CPU-only machines; fastest |
| Base (English) | 80–210 MB | English | Suggested automatically when WebGPU is available |
| Small (English) | 250–590 MB | English | Best English accuracy; needs WebGPU |
| Base (Multilingual) | 80–210 MB | 99 | Default when the browser isn't in English |
| Small (Multilingual) | 250–590 MB | 99 | Much better for Spanish, Chinese, Portuguese…; needs WebGPU |

Honest guidance: for Chinese or Spanish, *Base* is usable but weak; *Small* is the practical minimum for good quality in the browser. The desktop app with *Large v3 Turbo* is the best option.

The extension uses WebGPU when the browser exposes it, otherwise multi-threaded WebAssembly (the side panel is cross-origin isolated so ONNX Runtime can use threads).

### Desktop App (Windows + macOS)

Full-featured desktop app with extras the browser can't do:

- Global hotkey (`Ctrl+Shift+Space`) works from any app
- System tray - lives unobtrusively in your taskbar
- Privacy indicator - red "REC" pill on screen during recording
- Auto-paste - transcript appears in your active window automatically
- Sound feedback - beeps on start/stop (never recorded)
- Native Whisper (whisper.cpp) with beam search, Silero voice-activity detection and cross-segment context
- Optional GPU builds (Vulkan on Windows/Linux, Metal on macOS)
- Smart correction and prompt structuring with local models through Ollama - offline, no API key

**Download from [Releases](https://github.com/tdiipo1/Ideation/releases)**

Models offered in the desktop app (`Settings → Whisper Model`; base.en is bundled):

| Model | Size | Languages | When to use |
|---|---|---|---|
| Base (English) | 142 MB | English | Bundled default; fast |
| Small (English) | 466 MB | English | Suggested on machines with 8+ cores |
| Base (Multilingual) | 142 MB | 99 | Smallest multilingual option |
| Small (Multilingual) | 466 MB | 99 | Good middle ground for Spanish/Chinese/Portuguese |
| Large v3 Turbo (Multilingual) | 574 MB | 99 | Best quality; fast machines or GPU builds |
| Distil Large v3.5 (English) | 1.5 GB | English | Highest English quality; fast machines |

## Tech Stack

### Desktop
- **Framework:** Tauri v2 (Rust + React + TypeScript)
- **Transcription:** whisper-rs (native whisper.cpp bindings), one `WhisperState` per recording, Silero VAD driven standalone
- **Audio:** cpal + rubato (capture downsampled to 16 kHz on the fly)
- **LLM:** Ollama (Phi, Gemma, Qwen… local), Gemini/OpenAI/Anthropic/Groq (API)

### Chrome Extension
- **Transcription:** Transformers.js (Whisper ONNX; WebGPU or multi-threaded WebAssembly)
- **Audio:** getUserMedia + AudioWorklet
- **UI:** React + TypeScript + Tailwind CSS, Chrome i18n
- **LLM:** Google Gemini (shared free key included), BYOK for other providers

## Building from Source

### Prerequisites
- Node.js 18+
- Rust toolchain (rustup), 1.88 or newer
- MSVC Build Tools (Windows) or Xcode CLI Tools (macOS)
- CMake
- LLVM/Clang (for whisper-rs bindgen)

### Desktop App
```bash
cd desktop
npm install
# Windows: tell bindgen where libclang is
export LIBCLANG_PATH="C:/Program Files/LLVM/bin"
npm run tauri build                 # installers in src-tauri/target/release/bundle/
npm run tauri -- build --no-bundle  # just the exe, faster for testing
```

The bundled model `desktop/src-tauri/resources/ggml-base.en.bin` is not in git (too large). Download it once:
```bash
curl -L -o desktop/src-tauri/resources/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

**CPU flags.** whisper-rs-sys forwards `GGML_*` environment variables to CMake, but keeps whatever its cached build was configured with. For a distributable release build set (before the first build, or after deleting `target/release/build/whisper-rs-sys-*`):
```
GGML_NATIVE=OFF GGML_AVX=ON GGML_AVX2=ON GGML_FMA=ON GGML_F16C=ON
```
This targets x86-64-v3 (any x86 CPU since ~2013). `GGML_NATIVE=ON` tunes for the build machine only.

**GPU builds (optional).**
```bash
npm run tauri -- build --features gpu-vulkan   # Windows/Linux: needs the LunarG Vulkan SDK (VULKAN_SDK, glslc on PATH)
npm run tauri -- build --features gpu-metal    # macOS
```
GPU builds fall back to the CPU automatically if the GPU can't load the model, and show a "GPU acceleration" toggle in Settings. Publish the CPU build as the default download until a GPU build has been tested on the target machines (the Vulkan loader must be present).

Note (Windows): the app keeps running in the tray after its window is closed and holds a lock on `ideation.exe`; quit it from the tray before rebuilding.

### Chrome Extension
```bash
cd extension
npm install
npm run build        # Builds both Lite and Full
npm run build:lite   # Lite only
npm run build:full   # Full only
```

Load the built extension from `extension/dist-lite/` or `extension/dist-full/` in `chrome://extensions/` (Developer mode). The Full edition reads the shared Gemini key from `VITE_SHARED_GEMINI_KEY` (put it in `extension/.env`, which is git-ignored).

### Benchmarks and spikes
- Extension: `node scripts/bench.mjs file.wav --model onnx-community/whisper-base --language auto [--ref reference.txt] [--prompt "previous text"]` runs the same Transformers.js build in Node and prints the transcript, timing, detected language and WER/CER against a reference.
- Desktop: `IDEATION_BENCH_WAV=clip.wav IDEATION_BENCH_MODEL=path/to/ggml-base.bin IDEATION_BENCH_LANG=auto cargo test --release --lib bench -- --ignored --nocapture` (run in `desktop/src-tauri`).
- Unit tests: `cargo test --lib` in `desktop/src-tauri` (text rules, healing, VAD cut rule, resampler).

## Prompt Structuring and Smart Correction

Both features send text (never audio) to an LLM. Supported providers:

| Provider | Cost | Notes |
|----------|------|-------|
| Ollama (desktop only) | Free, offline | Phi, Gemma, Qwen, Llama… whatever you have pulled |
| Google Gemini | Free | Shared key included (extension), or bring your own |
| OpenAI | Paid (BYOK) | gpt-4o-mini default |
| Anthropic | Paid (BYOK) | claude-sonnet default |
| Groq | Free tier (BYOK) | llama-3.1-8b-instant default |

Smart correction is off by default. On desktop it only ever uses Ollama (nothing leaves the machine). In the extension it uses the provider configured for structuring and is clearly labeled as sending the transcript text.

## Privacy

- Audio is processed locally - never sent to any server
- Transcripts stored locally on your device
- No analytics, no telemetry, no data collection
- API keys stored locally, never transmitted to us
- Prompt structuring and smart correction only send text to the provider YOU choose, and only when enabled

Full [Privacy Policy](extension/PRIVACY_POLICY.md).

## License

MIT - see [LICENSE](LICENSE).
