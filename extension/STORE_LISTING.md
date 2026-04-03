# Chrome Web Store Submission Guide

## Prerequisites
1. Create a Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole/
2. Pay $5 one-time registration fee
3. Have the zip files ready in `extension/release/`

## Upload Steps
1. Go to https://chrome.google.com/webstore/devconsole/
2. Click "New Item"
3. Upload `ideation-lite.zip` or `ideation-full.zip`
4. Fill in the listing details below

---

## Ideation Lite — Store Listing

**Name:** Ideation Lite

**Summary (132 chars max):**
Quick voice-to-text in your browser. Record, transcribe locally with Whisper AI, and copy. No cloud, no subscription.

**Description:**
Ideation Lite captures your voice and turns it into text — instantly, privately, and for free.

How it works:
1. Click the extension icon to open the side panel
2. Click the mic button and start talking
3. Click again to stop — your transcript appears and is copied to clipboard
4. Paste it anywhere

Key features:
• Local AI transcription — Whisper runs in your browser, nothing leaves your device
• No account required — no sign-up, no subscription, no cloud
• Side panel UI — stays open while you browse
• Automatic clipboard copy — paste your transcript anywhere
• Works offline after first model download (~75MB one-time)

Built for people who think by talking. Capture your ideas, notes, and drafts without typing.

**Category:** Productivity

**Language:** English

---

## Ideation — Store Listing

**Name:** Ideation

**Summary (132 chars max):**
Voice-to-text with AI prompt structuring. Record, transcribe locally, clean up, and structure into prompts. Free.

**Description:**
Ideation turns your spoken thoughts into structured, ready-to-use text — all running locally in your browser.

How it works:
1. Click the extension icon to open the side panel
2. Record your thoughts — ramble as long as you need
3. Get a clean transcript with filler words removed and grammar fixed
4. Optionally restructure it into a polished AI prompt with one click
5. Copy and paste anywhere

Key features:
• Local AI transcription — Whisper runs entirely in your browser
• Transcript healing — removes "um", "uh", fixes capitalization, cleans up artifacts
• Prompt structuring — restructure your stream of consciousness into organized prompts (requires free Google Gemini API key)
• Transcript history — browse, search, and re-copy past transcripts
• Side panel UI — stays open while you browse other tabs
• Settings — choose your Whisper model, configure LLM provider
• No subscription — completely free
• Privacy-first — audio never leaves your device

Supported AI providers for prompt structuring (bring your own key):
• Google Gemini (free API key available)
• OpenAI
• Anthropic
• Groq

**Category:** Productivity

**Language:** English

---

## Required Assets

### Screenshots (1280x800 or 640x400)
You need 1-5 screenshots. Take these from Chrome:
1. Side panel showing the recording state (mic button active)
2. Side panel showing a completed transcript
3. Side panel showing the history tab (Ideation Full only)
4. Side panel showing settings (Ideation Full only)

### Icon
Already included in the build at 128x128.

### Tile images
- Small tile: 440x280 (promotional, optional)
- Large tile: 920x680 (promotional, optional)

---

## Review Notes for Chrome Web Store Team

**Why `wasm-unsafe-eval` in CSP:**
This extension runs OpenAI's Whisper speech recognition model locally in the browser using ONNX Runtime WebAssembly. The `wasm-unsafe-eval` directive is required to compile and execute the WASM binary for ML inference. No code is fetched from external sources — the WASM binary is bundled with the extension.

**Why `host_permissions` for huggingface.co:**
The Whisper AI model weights (~75MB) are downloaded from Hugging Face on first use and cached locally in IndexedDB. This is a one-time download. After caching, the extension works offline.

**Why `host_permissions` for API providers (Full edition only):**
The prompt structuring feature allows users to optionally send their transcript to an AI provider (Google Gemini, OpenAI, Anthropic, or Groq) using their own API key. No user data is collected or stored by the extension developer.
