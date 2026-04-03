# Ideation

**Voice-to-prompt tool.** Press a button, talk, get clean text. That's it.

Ideation captures your spoken thoughts and turns them into structured, ready-to-use text. Built for people who think by talking.

## How It Works

1. **Record** - Click the mic or press the shortcut
2. **Transcribe** - Whisper AI runs locally (nothing leaves your device)
3. **Clean up** - Filler words removed, grammar fixed, text polished
4. **Structure** - Optionally restructure into an organized prompt with one click
5. **Use** - Copy and paste anywhere

## Products

### Chrome Extension

Two editions from one codebase:

| | Ideation Lite | Ideation |
|---|---|---|
| Record + Transcribe | Yes | Yes |
| Copy to clipboard | Yes | Yes |
| Transcript healing | - | Yes |
| History | - | Yes |
| Prompt structuring | - | Yes (Gemini free) |
| Settings | - | Yes |
| Side Panel UI | Yes | Yes |

**Install from the [Chrome Web Store](#)** (pending review)

### Desktop App (Windows + macOS)

Full-featured desktop app with extras the browser can't do:

- Global hotkey (`Ctrl+Shift+Space`) works from any app
- System tray - lives unobtrusively in your taskbar
- Privacy indicator - red "REC" pill on screen during recording
- Auto-paste - transcript appears in your active window automatically
- Sound feedback - beeps on start/stop
- Native Whisper - 3-5x faster transcription than the browser version
- Phi-4-mini local LLM - offline prompt structuring, no API key needed

**Download from [Releases](https://github.com/tdiipo1/Ideation/releases)**

## Tech Stack

### Desktop
- **Framework:** Tauri v2 (Rust + React + TypeScript)
- **Transcription:** whisper-rs (native whisper.cpp bindings)
- **Audio:** cpal + rubato (capture + 16kHz resampling)
- **LLM:** Phi-4-mini via llama-cpp-rs (local), Gemini/OpenAI/Anthropic/Groq (API)

### Chrome Extension
- **Transcription:** Transformers.js (Whisper ONNX via WebAssembly)
- **Audio:** getUserMedia + AudioContext
- **UI:** React + TypeScript + Tailwind CSS
- **LLM:** Google Gemini (shared free key included), BYOK for other providers

## Building from Source

### Prerequisites
- Node.js 18+
- Rust toolchain (rustup)
- MSVC Build Tools (Windows) or Xcode CLI Tools (macOS)
- LLVM/Clang (for whisper-rs bindgen)

### Desktop App
```bash
cd desktop
npm install
# Set environment
export LIBCLANG_PATH="C:/Program Files/LLVM/bin"  # Windows
npx tauri build
```

### Chrome Extension
```bash
cd extension
npm install
npm run build        # Builds both Lite and Full
npm run build:lite   # Lite only
npm run build:full   # Full only
```

Load the built extension from `extension/dist-lite/` or `extension/dist-full/` in `chrome://extensions/` (Developer mode).

## Prompt Structuring

The optional prompt structuring feature restructures your raw transcript into a clean, organized prompt. Supported providers:

| Provider | Cost | Notes |
|----------|------|-------|
| Google Gemini | Free | Shared key included, or bring your own |
| OpenAI | Paid (BYOK) | gpt-4o-mini default |
| Anthropic | Paid (BYOK) | claude-sonnet default |
| Groq | Free tier (BYOK) | llama-3.1-8b-instant default |
| Phi-4-mini (desktop only) | Free, offline | Runs locally, ~4GB RAM |

## Privacy

- Audio is processed locally - never sent to any server
- Transcripts stored locally on your device
- No analytics, no telemetry, no data collection
- API keys stored locally, never transmitted to us
- Prompt structuring only sends text to the provider YOU choose

Full [Privacy Policy](extension/PRIVACY_POLICY.md).

## License

MIT
