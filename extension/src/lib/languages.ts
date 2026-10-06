// Languages offered in the picker. Codes are ISO-639-1 as Whisper expects
// them (`<|es|>`, `<|zh|>` ...). "auto" means: detect once per recording on
// the first segment with enough speech, then lock for the rest of it.
// Mirrors desktop/src/lib/languages.ts.

export const AUTO_LANGUAGE = "auto";

export const LANGUAGES: ReadonlyArray<readonly [code: string, nativeName: string]> = [
  ["auto", "Auto-detect"],
  ["en", "English"],
  ["es", "Español"],
  ["zh", "中文"],
  ["pt", "Português"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["it", "Italiano"],
  ["ru", "Русский"],
  ["ar", "العربية"],
  ["hi", "हिन्दी"],
  ["nl", "Nederlands"],
  ["pl", "Polski"],
  ["tr", "Türkçe"],
  ["vi", "Tiếng Việt"],
  ["id", "Bahasa Indonesia"],
  ["uk", "Українська"],
  ["sv", "Svenska"],
];

const NAME_BY_CODE = new Map<string, string>(LANGUAGES);

/** Native display name for a Whisper language code; falls back to the code. */
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  return NAME_BY_CODE.get(code) ?? code.toUpperCase();
}

/** Two-letter language of the browser UI ("es" for "es-419", "zh" for "zh-CN"). */
export function uiLanguage(): string {
  try {
    const raw =
      (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage?.()) ||
      navigator.language ||
      "en";
    return raw.slice(0, 2).toLowerCase();
  } catch {
    return "en";
  }
}
