# Privacy Policy — Ideation Chrome Extension

**Last updated:** October 5, 2026

## Summary
Ideation processes all audio and transcription locally on your device. We do not collect, store, or transmit any user data.

## Data Collection
**We collect no data.** Specifically:

- **Audio:** Captured from your microphone, processed locally in your browser using the Whisper AI model, and never transmitted to any server.
- **Transcripts:** Stored locally in your browser's extension storage (Ideation Full keeps a history; Ideation Lite stores nothing). Transcript text is only sent somewhere if you use an AI feature described below.
- **API keys:** Stored locally in your browser's extension storage. Never transmitted to us or any third party other than the provider the key belongs to.
- **Usage data:** We do not collect analytics, telemetry, or usage statistics of any kind. The extension has no backend.

## AI Features That Send Text (Ideation Full only)
Two optional features send the *text* of a transcript (never audio) directly from your browser to the AI provider you selected (Google Gemini, OpenAI, Anthropic, or Groq):

- **Prompt structuring** — only when you click "Structure as Prompt".
- **Smart correction** — only when you turn it on in Settings (it is off by default). When on, the transcript text of each recording is sent to the provider after transcription.

This is a direct connection between your browser and the provider's API — we are not an intermediary and do not see or store this data. The provider's own privacy policy applies to that request. If you use the included shared Google Gemini key, requests are made with that key; you can use your own key instead.

## Third-Party Services
- **Hugging Face:** The Whisper AI model (40–600 MB depending on the model you choose) is downloaded from Hugging Face on first use and cached locally in the browser's Cache Storage. No user data is sent to Hugging Face.
- **AI Providers (optional):** Only used by the two features above.

## Permissions
- **Microphone:** Used to record your voice for transcription. Audio is processed locally.
- **Storage** (Full only): Stores your transcript history and settings locally.
- **Unlimited storage:** Lets the browser keep the cached model weights instead of evicting them.
- **Clipboard write:** Copies the transcript to your clipboard after each recording.
- **Scripting / active tab:** The "Insert" action types the transcript into the text field you have focused on the current tab. It runs only when you ask for it and only inserts the transcript text.
- **Side Panel:** Displays the extension UI.
- **Cross-origin isolation:** Allows the speech model to run on several CPU threads. It does not involve any data transfer.

## Contact
For questions about this privacy policy, please open an issue on the project's GitHub repository.
