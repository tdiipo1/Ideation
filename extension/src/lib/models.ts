// Single registry of the Whisper ONNX models the extension can run. Used by
// the settings panel, the one-time model nudges and the Lite edition default,
// so the "is this model multilingual?" question has exactly one answer.
//
// Download sizes depend on the backend: WASM loads q8 weights, WebGPU loads
// an fp32 encoder + q4 decoder (the recipe with the fewest precision issues).

export interface WhisperModel {
  id: string;
  label: string;
  /** i18n keys for the label and note (see public/_locales). */
  labelKey: string;
  noteKey: string;
  /** Approximate one-time download, WASM / WebGPU. */
  sizeNote: string;
  note: string;
  multilingual: boolean;
  tier: "tiny" | "base" | "small";
  /** Comfortable only with WebGPU acceleration. */
  gpuRecommended?: boolean;
}

export const TINY_EN = "onnx-community/whisper-tiny.en";
export const BASE_EN = "onnx-community/whisper-base.en";
export const SMALL_EN = "onnx-community/whisper-small.en";
export const BASE_MULTI = "onnx-community/whisper-base";
export const SMALL_MULTI = "onnx-community/whisper-small";

export const WHISPER_MODELS: readonly WhisperModel[] = [
  {
    id: TINY_EN,
    label: "Tiny (English)",
    labelKey: "modelTinyEn",
    noteKey: "modelNoteTinyEn",
    sizeNote: "40–120 MB",
    note: "Fastest. Default on CPU-only machines.",
    multilingual: false,
    tier: "tiny",
  },
  {
    id: BASE_EN,
    label: "Base (English)",
    labelKey: "modelBaseEn",
    noteKey: "modelNoteBaseEn",
    sizeNote: "80–210 MB",
    note: "More accurate; comfortable with GPU acceleration.",
    multilingual: false,
    tier: "base",
  },
  {
    id: SMALL_EN,
    label: "Small (English)",
    labelKey: "modelSmallEn",
    noteKey: "modelNoteSmallEn",
    sizeNote: "250–590 MB",
    note: "Best English accuracy. Needs GPU acceleration.",
    multilingual: false,
    tier: "small",
    gpuRecommended: true,
  },
  {
    id: BASE_MULTI,
    label: "Base (Multilingual)",
    labelKey: "modelBaseMulti",
    noteKey: "modelNoteBaseMulti",
    sizeNote: "80–210 MB",
    note: "99 languages. Default when the browser isn't in English.",
    multilingual: true,
    tier: "base",
  },
  {
    id: SMALL_MULTI,
    label: "Small (Multilingual)",
    labelKey: "modelSmallMulti",
    noteKey: "modelNoteSmallMulti",
    sizeNote: "250–590 MB",
    note: "Much better for Spanish, Chinese, Portuguese… Needs GPU acceleration.",
    multilingual: true,
    tier: "small",
    gpuRecommended: true,
  },
];

export function findModel(id: string): WhisperModel | undefined {
  return WHISPER_MODELS.find((m) => m.id === id);
}

/**
 * Whether a model can transcribe languages other than English. Unknown ids
 * (e.g. a value saved by an older version) fall back to Whisper's naming
 * convention: ".en" and distil-* checkpoints are English-only.
 */
export function isMultilingualModel(id: string | null | undefined): boolean {
  if (!id) return false;
  const known = findModel(id);
  if (known) return known.multilingual;
  return !id.endsWith(".en") && !id.includes("distil");
}

/** Default model for a browser UI language: English → tiny.en, else Base (Multilingual). */
export function defaultModelFor(uiLang: string): string {
  return uiLang === "en" ? TINY_EN : BASE_MULTI;
}

/** The multilingual model to suggest when the user's language isn't English. */
export function multilingualUpgradeFor(device: string | null): string {
  return device === "webgpu" ? SMALL_MULTI : BASE_MULTI;
}
