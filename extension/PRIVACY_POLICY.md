# Privacy Policy — Ideation Chrome Extension

**Last updated:** April 2, 2026

## Summary
Ideation processes all audio and transcription locally on your device. We do not collect, store, or transmit any user data.

## Data Collection
**We collect no data.** Specifically:

- **Audio:** Captured from your microphone, processed locally in your browser using the Whisper AI model, and never transmitted to any server.
- **Transcripts:** Stored locally in your browser's storage. Never sent anywhere unless you explicitly use the prompt structuring feature with your own API key.
- **API keys:** Stored locally in your browser's extension storage. Never transmitted to us or any third party.
- **Usage data:** We do not collect analytics, telemetry, or usage statistics of any kind.

## Prompt Structuring (Optional)
If you choose to use the prompt structuring feature, your transcript text is sent to the AI provider you selected (Google Gemini, OpenAI, Anthropic, or Groq) using your own API key. This is a direct connection between your browser and the provider's API — we are not an intermediary and do not see or store this data.

## Third-Party Services
- **Hugging Face:** The Whisper AI model (~75MB) is downloaded from Hugging Face on first use and cached locally. No user data is sent to Hugging Face.
- **AI Providers (optional):** Only used if you explicitly configure prompt structuring with your own API key.

## Permissions
- **Microphone:** Used to record your voice for transcription. Audio is processed locally.
- **Storage:** Used to store your transcript history and settings locally.
- **Side Panel:** Used to display the extension UI.

## Contact
For questions about this privacy policy, please open an issue on the project's GitHub repository.
