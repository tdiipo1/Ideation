# Chrome Web Store Submission Guide

## Prerequisites
1. Create a Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole/
2. Pay $5 one-time registration fee
3. Build and zip the editions:
   ```bash
   cd extension
   npm install
   npm run build
   # Windows PowerShell
   Compress-Archive -Path dist-full\* -DestinationPath release\ideation-full-0.2.0.zip -Force
   Compress-Archive -Path dist-lite\* -DestinationPath release\ideation-lite-0.2.0.zip -Force
   ```
   Each zip is about 5.5 MB (one ONNX Runtime binary; models are downloaded on first use).

## Upload Steps
1. Go to https://chrome.google.com/webstore/devconsole/
2. Open the existing item (or "New Item" for a first upload)
3. Upload `ideation-lite-0.2.0.zip` or `ideation-full-0.2.0.zip`
4. Fill in / update the listing details below. The store listing supports multiple languages: the extension's own name and description are localized through `_locales` (en, es, zh_CN), so add Spanish and Chinese listing text in the console as well.

---

## Ideation Lite — Store Listing

**Name:** Ideation Lite

**Summary (132 chars max):**
Quick voice-to-text in any language. Record, transcribe locally with Whisper AI, copy. No cloud, no account, no subscription.

**Description:**
Ideation Lite captures your voice and turns it into text — instantly, privately, and for free.

How it works:
1. Click the extension icon to open the side panel
2. Click the mic button and start talking — captions appear while you speak
3. Click again to stop — your transcript is copied to the clipboard
4. Paste it anywhere, or use Insert to type it into the field you were in

Key features:
• Local AI transcription — Whisper runs in your browser, nothing leaves your device
• Any language — the spoken language is detected automatically (99 languages with the multilingual model, chosen by your browser language)
• No account required — no sign-up, no subscription, no cloud
• Side panel UI — stays open while you browse
• Automatic clipboard copy — paste your transcript anywhere
• Works offline after the first model download (40–210 MB, one time)
• Interface in English, Spanish and Chinese

Built for people who think by talking. Capture your ideas, notes, and drafts without typing.

**Category:** Productivity

**Languages:** English, Spanish, Chinese (Simplified)

---

## Ideation — Store Listing

**Name:** Ideation

**Summary (132 chars max):**
Voice-to-text in any language with cleanup and AI prompt structuring. Transcribes locally with Whisper. Free, private.

**Description:**
Ideation turns your spoken thoughts into structured, ready-to-use text — the transcription runs locally in your browser.

How it works:
1. Click the extension icon to open the side panel
2. Record your thoughts — ramble as long as you need, captions appear live
3. Get a clean transcript: filler words removed, stutters collapsed, capitalization fixed
4. Optionally restructure it into a polished AI prompt with one click
5. Copy and paste anywhere, or insert it straight into the page

Key features:
• Local AI transcription — Whisper runs entirely in your browser (WebGPU when available)
• Any language — auto-detected per recording, or pinned in Settings; 99 languages with the multilingual models
• Transcript healing — language-aware cleanup of "um", "eh", "嗯"…, capitalization and artifacts
• Smart correction (optional, off by default) — an AI model fixes words that were clearly misheard from context
• Prompt structuring — restructure your stream of consciousness into organized prompts (free Google Gemini key included, or bring your own)
• Transcript history — browse and re-copy past transcripts
• Side panel UI — stays open while you browse other tabs
• Settings — choose your Whisper model and language, configure the AI provider
• Interface in English, Spanish and Chinese
• No subscription — completely free
• Privacy-first — audio never leaves your device

Supported AI providers for prompt structuring and smart correction:
• Google Gemini (shared free key included, or your own)
• OpenAI
• Anthropic
• Groq

**Category:** Productivity

**Languages:** English, Spanish, Chinese (Simplified)

---

## Required Assets

### Screenshots (1280x800 or 640x400)
You need 1-5 screenshots. Retake them after this release (the UI changed: live captions, language chip, "N s behind" indicator, Language setting):
1. Side panel while recording, with live captions and the detected-language chip
2. Side panel showing a completed transcript (Healed / Raw tabs, Insert and Copy)
3. Side panel showing the history tab (Ideation Full only)
4. Side panel showing settings with the Language and Whisper Model sections (Ideation Full only)
5. Optional: a Spanish or Chinese recording

`resize-screenshots.cjs` / `resize-lite.cjs` pad raw side-panel captures to 1280x800.

### Icon
Already included in the build at 128x128 (16/48 are real sizes as of 0.2.0).

### Tile images
- Small tile: 440x280 (promotional, optional)
- Large tile: 920x680 (promotional, optional)

---

## Review Notes for Chrome Web Store Team

**Why `wasm-unsafe-eval` in CSP:**
This extension runs OpenAI's Whisper speech recognition model locally in the browser using ONNX Runtime WebAssembly. The `wasm-unsafe-eval` directive is required to compile and execute the WASM binary for ML inference. No code is fetched from external sources — the WASM binary is bundled with the extension.

**Why `cross_origin_embedder_policy` / `cross_origin_opener_policy`:**
These make the side panel cross-origin isolated so `SharedArrayBuffer` is available and ONNX Runtime can run the model on several WebAssembly threads. Without it transcription runs single-threaded and is several times slower on machines without WebGPU.

**Why `host_permissions` for huggingface.co (and *.hf.co):**
The Whisper model weights (40–600 MB depending on the chosen model) are downloaded from Hugging Face on first use and cached in the browser's Cache Storage. This is a one-time download. After caching, the extension works offline.

**Why `unlimitedStorage`:**
The cached model weights can exceed the default storage quota; without this permission the browser may evict them and force a re-download.

**Why `clipboardWrite`:**
The transcript is copied to the clipboard automatically after each recording (the product's core action).

**Why `scripting` and `activeTab`:**
The optional "Insert" button types the transcript into the text field the user has focused on the current tab. The script runs only when the user clicks Insert (or has enabled auto-insert), only on the active tab, and only writes the transcript text.

**Why `storage` (Full edition only):**
Settings and the transcript history are stored locally in `chrome.storage.local`.

**Why `host_permissions` for API providers (Full edition only):**
The prompt structuring and optional smart correction features send the transcript *text* to the AI provider the user selected (Google Gemini, OpenAI, Anthropic, or Groq). Smart correction is off by default and labeled as sending text. No user data is collected or stored by the extension developer.
