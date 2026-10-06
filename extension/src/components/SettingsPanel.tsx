import { useState, useEffect, useRef } from "react";
import type { ExtSettings } from "../types";
import { fetchGeminiModels, GeminiModel } from "../lib/structuring";
import { SHARED_GEMINI_KEY } from "../types";
import { WHISPER_MODELS, BASE_MULTI, isMultilingualModel } from "../lib/models";
import { LANGUAGES, languageName } from "../lib/languages";
import { t } from "../lib/i18n";

interface SettingsPanelProps {
  settings: ExtSettings;
  onUpdate: (patch: Partial<ExtSettings>) => void;
  onSave: () => void;
}

export default function SettingsPanel({ settings, onUpdate, onSave }: SettingsPanelProps) {
  const [saved, setSaved] = useState(false);
  const [geminiModels, setGeminiModels] = useState<GeminiModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const savedTimeoutRef = useRef<number | null>(null);

  const activeKey =
    settings.llmKeyMode === "shared" ? SHARED_GEMINI_KEY : settings.llmApiKey;

  useEffect(() => {
    if (settings.llmProvider === "gemini" && activeKey) {
      setLoadingModels(true);
      fetchGeminiModels(activeKey)
        .then(setGeminiModels)
        .finally(() => setLoadingModels(false));
    }
  }, [settings.llmProvider, activeKey]);

  // Clear saved-feedback timeout on unmount to prevent state updates after unmount
  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current !== null) {
        clearTimeout(savedTimeoutRef.current);
        savedTimeoutRef.current = null;
      }
    };
  }, []);

  function handleSave() {
    onSave();
    setSaved(true);
    if (savedTimeoutRef.current !== null) {
      clearTimeout(savedTimeoutRef.current);
    }
    savedTimeoutRef.current = window.setTimeout(() => {
      setSaved(false);
      savedTimeoutRef.current = null;
    }, 2000);
  }

  const modelIsMultilingual = isMultilingualModel(settings.modelId);
  const pinnedNonEnglish = settings.language !== "auto" && settings.language !== "en";

  return (
    <div className="flex flex-col gap-4">
      {/* Language */}
      <section>
        <h3 className="text-xs font-semibold text-neutral-400 mb-2">{t("settingsLanguage")}</h3>
        <select
          value={settings.language}
          onChange={(e) => onUpdate({ language: e.target.value })}
          className="w-full text-xs px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded focus:outline-none focus:border-blue-500"
        >
          {LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-neutral-600 mt-1">{t("languageAutoHint")}</p>
        {pinnedNonEnglish && !modelIsMultilingual && (
          <div className="mt-2 text-[10px] text-amber-400 bg-amber-400/10 px-2 py-1.5 rounded flex items-center justify-between gap-2">
            <span>
              {t("languageNeedsMultilingual", [languageName(settings.language) ?? settings.language])}
            </span>
            <button
              onClick={() => onUpdate({ modelId: BASE_MULTI })}
              className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 rounded whitespace-nowrap"
            >
              {t("useBaseMultilingual")}
            </button>
          </div>
        )}
        {!pinnedNonEnglish && !modelIsMultilingual && (
          <p className="text-[10px] text-neutral-600 mt-1">{t("modelEnglishOnlyHint")}</p>
        )}
      </section>

      {/* Whisper Model */}
      <section>
        <h3 className="text-xs font-semibold text-neutral-400 mb-2">{t("settingsWhisperModel")}</h3>
        {WHISPER_MODELS.map((m) => (
          <label
            key={m.id}
            className={`flex items-start gap-2 px-2.5 py-2 rounded border mb-1 cursor-pointer ${
              settings.modelId === m.id
                ? "border-blue-500 bg-blue-500/10"
                : "border-neutral-800 bg-neutral-900"
            }`}
          >
            <input
              type="radio"
              checked={settings.modelId === m.id}
              onChange={() => onUpdate({ modelId: m.id })}
              className="accent-blue-500 mt-0.5"
            />
            <div className="flex flex-col flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs">{t(m.labelKey)}</span>
                <span className="text-[10px] text-neutral-500">{m.sizeNote}</span>
                {m.gpuRecommended && (
                  <span className="text-[9px] px-1 py-px rounded bg-neutral-800 text-neutral-400">
                    {t("gpuTag")}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-neutral-600">{t(m.noteKey)}</span>
            </div>
          </label>
        ))}
        <p className="text-[10px] text-neutral-600 mt-1">{t("modelChangeHint")}</p>
      </section>

      {/* Behavior */}
      <section>
        <h3 className="text-xs font-semibold text-neutral-400 mb-2">{t("settingsBehavior")}</h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            onClick={() => onUpdate({ healingEnabled: !settings.healingEnabled })}
            className={`w-8 h-4 rounded-full transition-colors relative ${
              settings.healingEnabled ? "bg-blue-500" : "bg-neutral-700"
            }`}
          >
            <div
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                settings.healingEnabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </div>
          <div>
            <span className="text-xs">{t("healingLabel")}</span>
            <p className="text-[10px] text-neutral-500">{t("healingHint")}</p>
          </div>
        </label>
        <label className="flex items-center gap-2 cursor-pointer mt-2">
          <div
            onClick={() => onUpdate({ insertIntoPage: !settings.insertIntoPage })}
            className={`w-8 h-4 rounded-full transition-colors relative ${
              settings.insertIntoPage ? "bg-blue-500" : "bg-neutral-700"
            }`}
          >
            <div
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                settings.insertIntoPage ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </div>
          <div>
            <span className="text-xs">{t("insertLabel")}</span>
            <p className="text-[10px] text-neutral-500">{t("insertHint")}</p>
          </div>
        </label>
      </section>

      {/* Prompt Structuring */}
      <section>
        <h3 className="text-xs font-semibold text-neutral-400 mb-2">{t("settingsStructuring")}</h3>
        <p className="text-[10px] text-neutral-500 mb-2">{t("structuringHint")}</p>
        <div className="flex flex-col gap-2">
          {/* Provider */}
          <select
            value={settings.llmProvider}
            onChange={(e) => onUpdate({ llmProvider: e.target.value as ExtSettings["llmProvider"] })}
            className="text-xs px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded focus:outline-none focus:border-blue-500"
          >
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI ({t("paid")})</option>
            <option value="anthropic">Anthropic ({t("paid")})</option>
            <option value="groq">Groq</option>
          </select>

          {/* Paid provider warning */}
          {(settings.llmProvider === "openai" || settings.llmProvider === "anthropic") && (
            <p className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-1.5 rounded">
              {t("providerPaidWarning", [settings.llmProvider === "openai" ? "OpenAI" : "Anthropic"])}
            </p>
          )}

          {/* Key mode (Gemini only) */}
          {settings.llmProvider === "gemini" && (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={settings.llmKeyMode === "shared"}
                  onChange={() => onUpdate({ llmKeyMode: "shared" })}
                  className="accent-blue-500"
                />
                <div>
                  <span className="text-xs">{t("sharedKeyLabel")}</span>
                  <p className="text-[10px] text-neutral-500">{t("sharedKeyHint")}</p>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={settings.llmKeyMode === "own"}
                  onChange={() => onUpdate({ llmKeyMode: "own" })}
                  className="accent-blue-500"
                />
                <div>
                  <span className="text-xs">{t("ownKeyLabel")}</span>
                  <p className="text-[10px] text-neutral-500">{t("ownKeyHint")}</p>
                </div>
              </label>
            </div>
          )}

          {/* API Key input (own key mode or non-Gemini providers) */}
          {(settings.llmKeyMode === "own" || settings.llmProvider !== "gemini") && (
            <input
              type="password"
              value={settings.llmApiKey}
              onChange={(e) => onUpdate({ llmApiKey: e.target.value })}
              placeholder={t("apiKeyPlaceholder")}
              className="text-xs px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded focus:outline-none focus:border-blue-500"
            />
          )}

          {/* Model picker (Gemini) */}
          {settings.llmProvider === "gemini" && (
            <div>
              <label className="text-[10px] text-neutral-400 mb-1 block">{t("modelLabel")}</label>
              {settings.llmKeyMode === "shared" ? (
                // Shared key: only show confirmed free-tier models
                <select
                  value={settings.llmModel || "gemini-2.5-flash"}
                  onChange={(e) => onUpdate({ llmModel: e.target.value })}
                  className="w-full text-xs px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded focus:outline-none focus:border-blue-500"
                >
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                </select>
              ) : loadingModels ? (
                <p className="text-[10px] text-neutral-500">{t("loadingModels")}</p>
              ) : geminiModels.length > 0 ? (
                <select
                  value={settings.llmModel || "gemini-2.5-flash"}
                  onChange={(e) => onUpdate({ llmModel: e.target.value })}
                  className="w-full text-xs px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded focus:outline-none focus:border-blue-500"
                >
                  {geminiModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={settings.llmModel}
                  onChange={(e) => onUpdate({ llmModel: e.target.value })}
                  placeholder="gemini-2.5-flash"
                  className="w-full text-xs px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded focus:outline-none focus:border-blue-500"
                />
              )}
              {settings.llmKeyMode === "shared" && (
                <p className="text-[10px] text-neutral-600 mt-1">{t("ownKeyModelsHint")}</p>
              )}
            </div>
          )}

          {/* Smart correction */}
          <label className="flex items-center gap-2 cursor-pointer mt-1">
            <div
              onClick={() => onUpdate({ smartCorrection: !settings.smartCorrection })}
              className={`w-8 h-4 rounded-full transition-colors relative ${
                settings.smartCorrection ? "bg-purple-500" : "bg-neutral-700"
              }`}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  settings.smartCorrection ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </div>
            <div>
              <span className="text-xs">{t("smartCorrectionLabel")}</span>
              <p className="text-[10px] text-neutral-500">{t("smartCorrectionHint")}</p>
            </div>
          </label>

          {/* Model input (non-Gemini) */}
          {settings.llmProvider !== "gemini" && (
            <input
              type="text"
              value={settings.llmModel}
              onChange={(e) => onUpdate({ llmModel: e.target.value })}
              placeholder={
                settings.llmProvider === "openai"
                  ? "gpt-4o-mini"
                  : settings.llmProvider === "anthropic"
                    ? "claude-sonnet-4-20250514"
                    : "llama-3.1-8b-instant"
              }
              className="text-xs px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded focus:outline-none focus:border-blue-500"
            />
          )}
        </div>
      </section>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className={`text-xs px-4 py-2 rounded-md transition-colors font-medium ${
          saved
            ? "bg-green-600 text-white"
            : "bg-blue-600 hover:bg-blue-500 text-white"
        }`}
      >
        {saved ? t("settingsSaved") : t("saveSettings")}
      </button>
    </div>
  );
}
