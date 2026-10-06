import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LANGUAGES, languageName } from "../lib/languages";

interface AppSettings {
  shortcut: string;
  whisper_model: string;
  healing_enabled: boolean;
  auto_paste: boolean;
  auto_copy: boolean;
  sound_feedback: boolean;
  llm_provider: string;
  llm_api_key: string;
  llm_model: string;
  language: string;
  smart_correction: boolean;
  use_gpu: boolean;
  ui_language: string;
  model_nudge_dismissed: boolean;
}

interface ModelInfo {
  name: string;
  label: string;
  description: string;
  filename: string;
  size_mb: number;
  english_only: boolean;
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [preloading, setPreloading] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadData();

    const unlisten = listen<{ model: string; progress: number }>(
      "model-download-progress",
      (event) => {
        setDownloadProgress((prev) => ({
          ...prev,
          [event.payload.model]: event.payload.progress,
        }));
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  async function loadData() {
    const s = await invoke<AppSettings>("get_settings");
    setSettings(s);

    const m = await invoke<ModelInfo[]>("get_available_models");
    setModels(m);

    const status: Record<string, boolean> = {};
    for (const model of m) {
      status[model.filename] = await invoke<boolean>("is_model_downloaded", {
        filename: model.filename,
      });
    }
    setDownloaded(status);
  }

  async function handleSave() {
    if (!settings) return;
    await invoke("save_settings", { newSettings: settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);

    // Eagerly preload the selected model into the WhisperContext cache so
    // the next transcription doesn't pay the disk-read cost on first use.
    if (downloaded[settings.whisper_model]) {
      setPreloading(settings.whisper_model);
      try {
        await invoke("preload_model", { filename: settings.whisper_model });
      } catch (err) {
        console.warn("Preload failed (non-fatal):", err);
      } finally {
        setPreloading(null);
      }
    }
  }

  function update(patch: Partial<AppSettings>) {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    setSaved(false);
  }

  // Select a model; download it first if it isn't on disk, then warm the
  // cache so the first transcription doesn't pay the disk-read cost.
  async function selectModel(model: ModelInfo) {
    update({ whisper_model: model.filename });
    if (downloaded[model.filename]) return;
    setDownloadError(null);
    setDownloadProgress((prev) => ({ ...prev, [model.name]: 0 }));
    try {
      await invoke("download_model", { modelName: model.name });
      setDownloaded((prev) => ({ ...prev, [model.filename]: true }));
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[model.name];
        return next;
      });
      setPreloading(model.filename);
      try {
        await invoke("preload_model", { filename: model.filename });
      } finally {
        setPreloading(null);
      }
    } catch (err) {
      setDownloadError(String(err));
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[model.name];
        return next;
      });
      setPreloading(null);
    }
  }

  if (!settings) return null;

  const currentModel = models.find((m) => m.filename === settings.whisper_model);
  const modelIsEnglishOnly = currentModel ? currentModel.english_only : false;
  const pinnedNonEnglish = settings.language !== "auto" && settings.language !== "en";
  const multilingualFallback = models.find((m) => m.name === "base");

  return (
    <div className="flex flex-col gap-5">
      {/* Language */}
      <section>
        <h3 className="text-sm font-semibold text-neutral-400 mb-2">Language</h3>
        <p className="text-xs text-neutral-500 mb-2">
          Auto-detect reads the language from the first seconds of each recording, then keeps
          it for the rest of it. Pin a language if detection ever guesses wrong.
        </p>
        <select
          value={settings.language}
          onChange={(e) => update({ language: e.target.value })}
          className="w-full text-sm px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-md focus:outline-none focus:border-blue-500"
        >
          {LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        {pinnedNonEnglish && modelIsEnglishOnly && (
          <div className="mt-2 text-xs text-amber-400 bg-amber-400/10 px-3 py-2 rounded-md flex items-center justify-between gap-3">
            <span>{languageName(settings.language)} needs a multilingual model.</span>
            {multilingualFallback && (
              <button
                onClick={() => selectModel(multilingualFallback)}
                className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 rounded whitespace-nowrap"
              >
                Use Base (Multilingual)
              </button>
            )}
          </div>
        )}
        {!pinnedNonEnglish && modelIsEnglishOnly && (
          <p className="text-xs text-neutral-600 mt-2">
            The selected model is English-only; other languages won't be recognized.
          </p>
        )}
      </section>

      {/* Shortcut */}
      <section>
        <h3 className="text-sm font-semibold text-neutral-400 mb-2">
          Global Shortcut
        </h3>
        <p className="text-xs text-neutral-500 mb-2">
          The keyboard shortcut to start/stop recording from anywhere.
          Restart the app after changing.
        </p>
        <input
          type="text"
          value={settings.shortcut}
          onChange={(e) => update({ shortcut: e.target.value })}
          className="w-full text-sm px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-md focus:outline-none focus:border-blue-500"
        />
      </section>

      {/* Whisper Model */}
      <section>
        <h3 className="text-sm font-semibold text-neutral-400 mb-2">
          Whisper Model
        </h3>
        <div className="flex flex-col gap-2">
          {models.map((model) => (
            <label
              key={model.filename}
              className={`flex items-center gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                settings.whisper_model === model.filename
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-neutral-800 bg-neutral-900 hover:border-neutral-700"
              }`}
            >
              <input
                type="radio"
                name="model"
                checked={settings.whisper_model === model.filename}
                onChange={() => selectModel(model)}
                className="accent-blue-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{model.label}</span>
                  <span className="text-xs text-neutral-500">
                    {model.size_mb >= 1024
                      ? `${(model.size_mb / 1024).toFixed(1)} GB`
                      : `${model.size_mb} MB`}
                  </span>
                  {!model.english_only && (
                    <span className="text-[10px] px-1 py-px rounded bg-neutral-800 text-neutral-400">
                      multilingual
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-600">{model.description}</p>
              </div>
              {preloading === model.filename ? (
                <span className="text-xs text-blue-400 animate-pulse">Preparing...</span>
              ) : downloaded[model.filename] ? (
                <span className="text-xs text-green-400">Downloaded</span>
              ) : settings.whisper_model === model.filename && downloadProgress[model.name] != null ? (
                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="flex-1 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${downloadProgress[model.name]}%` }}
                    />
                  </div>
                  <span className="text-xs text-blue-400 tabular-nums">
                    {downloadProgress[model.name]}%
                  </span>
                </div>
              ) : settings.whisper_model === model.filename && downloadError ? (
                <span className="text-xs text-red-400">Failed — click to retry</span>
              ) : (
                <span className="text-xs text-neutral-500">Select to download</span>
              )}
            </label>
          ))}
        </div>
      </section>

      {/* Toggles */}
      <section>
        <h3 className="text-sm font-semibold text-neutral-400 mb-3">
          Behavior
        </h3>
        <div className="flex flex-col gap-3">
          <Toggle
            label="Transcript healing"
            description="Clean up filler words, fix capitalization, remove artifacts"
            checked={settings.healing_enabled}
            onChange={(v) => update({ healing_enabled: v })}
          />
          <Toggle
            label="Auto-copy to clipboard"
            description="Automatically copy the transcript to clipboard after recording"
            checked={settings.auto_copy}
            onChange={(v) => update({ auto_copy: v })}
          />
          <Toggle
            label="Auto-paste"
            description="Automatically paste the transcript into the active window (simulates Ctrl+V)"
            checked={settings.auto_paste}
            onChange={(v) => update({ auto_paste: v })}
          />
          <Toggle
            label="Sound feedback"
            description="Play a beep when recording starts and stops"
            checked={settings.sound_feedback}
            onChange={(v) => update({ sound_feedback: v })}
          />
        </div>
      </section>

      {/* Prompt Structuring (LLM) */}
      <section>
        <h3 className="text-sm font-semibold text-neutral-400 mb-2">
          Prompt Structuring (LLM)
        </h3>
        <p className="text-xs text-neutral-500 mb-3">
          Restructure your transcript into a clean, organized prompt using an AI
          provider. Requires an API key.
        </p>

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-neutral-400 mb-1 block">
              Provider
            </label>
            <select
              value={settings.llm_provider}
              onChange={(e) => update({ llm_provider: e.target.value })}
              className="w-full text-sm px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-md focus:outline-none focus:border-blue-500"
            >
              <option value="local">Phi via Ollama (local, free, offline)</option>
              <option value="gemma4">Gemma via Ollama (local, free, offline)</option>
              <option value="gemini">Google Gemini (free)</option>
              <option value="openai">OpenAI (paid)</option>
              <option value="anthropic">Anthropic (paid)</option>
              <option value="groq">Groq</option>
            </select>
            {(settings.llm_provider === "local" || settings.llm_provider === "gemma4") && (
              <p className="text-xs text-neutral-500 mt-2">
                Requires <a href="https://ollama.com" target="_blank" className="text-blue-400 underline">Ollama</a> installed and running.
                Auto-detects your installed models — no extra setup needed.
              </p>
            )}
            {(settings.llm_provider === "openai" || settings.llm_provider === "anthropic") && (
              <p className="text-xs text-amber-400 bg-amber-400/10 px-3 py-2 rounded-md mt-2">
                This provider charges per API call. Usage costs are billed directly
                by {settings.llm_provider === "openai" ? "OpenAI" : "Anthropic"} to
                your account. Check their pricing page for current rates.
              </p>
            )}
          </div>

          {settings.llm_provider !== "local" && settings.llm_provider !== "gemma4" && <div>
            <label className="text-xs text-neutral-400 mb-1 block">
              API Key
            </label>
            <input
              type="password"
              value={settings.llm_api_key}
              onChange={(e) => update({ llm_api_key: e.target.value })}
              placeholder="sk-..."
              className="w-full text-sm px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-md focus:outline-none focus:border-blue-500"
            />
          </div>}

          {settings.llm_provider !== "local" && settings.llm_provider !== "gemma4" && <div>
            <label className="text-xs text-neutral-400 mb-1 block">
              Model (optional, leave blank for default)
            </label>
            <input
              type="text"
              value={settings.llm_model}
              onChange={(e) => update({ llm_model: e.target.value })}
              placeholder={
                settings.llm_provider === "gemini"
                  ? "gemini-2.5-flash"
                  : settings.llm_provider === "openai"
                    ? "gpt-4o-mini"
                    : settings.llm_provider === "anthropic"
                      ? "claude-sonnet-4-20250514"
                      : "llama-3.1-8b-instant"
              }
              className="w-full text-sm px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-md focus:outline-none focus:border-blue-500"
            />
          </div>}
        </div>
      </section>

      {/* Save */}
      <button
        onClick={handleSave}
        className={`text-sm px-4 py-2 rounded-md transition-colors ${
          saved
            ? "bg-green-600 text-white"
            : "bg-blue-600 hover:bg-blue-500 text-white"
        }`}
      >
        {saved ? "Saved!" : "Save Settings"}
      </button>
    </div>
  );
}



function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="pt-0.5">
        <div
          onClick={() => onChange(!checked)}
          className={`w-9 h-5 rounded-full transition-colors relative ${
            checked ? "bg-blue-500" : "bg-neutral-700"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              checked ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
    </label>
  );
}
