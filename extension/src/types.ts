export type RecordingState = "idle" | "recording" | "processing";
export type ModelState = "not-loaded" | "loading" | "ready" | "error";

export interface TranscriptResult {
  text: string;
  healed?: string;
  durationSecs: number;
  timestamp: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  durationSecs: number;
  raw: string;
  healed: string;
}

export interface ExtSettings {
  healingEnabled: boolean;
  modelId: string;
  llmProvider: "gemini" | "openai" | "anthropic" | "groq";
  llmKeyMode: "shared" | "own";
  llmApiKey: string;
  llmModel: string;
}

export const DEFAULT_SETTINGS: ExtSettings = {
  healingEnabled: true,
  modelId: "onnx-community/whisper-base.en",
  llmProvider: "gemini",
  llmKeyMode: "shared",
  llmApiKey: "",
  llmModel: "",
};

// Shared Gemini API key — free tier, no billing attached, rate limited
// Users see this labeled as "Ideation Shared (limited)"
// Replace this with your own key from https://aistudio.google.com/apikey
export const SHARED_GEMINI_KEY = "REPLACE_WITH_YOUR_GEMINI_KEY";

declare module "*.css" {}
