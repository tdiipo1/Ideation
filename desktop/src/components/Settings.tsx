import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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
}

interface ModelInfo {
  name: string;
  filename: string;
  size_mb: number;
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadData();
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
  }

  function update(patch: Partial<AppSettings>) {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    setSaved(false);
  }

  if (!settings) return null;

  return (
    <div className="flex flex-col gap-5">
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
                onChange={() => update({ whisper_model: model.filename })}
                className="accent-blue-500"
              />
              <div className="flex-1">
                <span className="text-sm font-medium">{model.name}</span>
                <span className="text-xs text-neutral-500 ml-2">
                  {model.size_mb} MB
                </span>
              </div>
              {downloaded[model.filename] ? (
                <span className="text-xs text-green-400">Downloaded</span>
              ) : (
                <span className="text-xs text-neutral-500">Not downloaded</span>
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
              <option value="local">Phi-4-mini (local, free, offline)</option>
              <option value="gemini">Google Gemini (free)</option>
              <option value="openai">OpenAI (paid)</option>
              <option value="anthropic">Anthropic (paid)</option>
              <option value="groq">Groq</option>
            </select>
            {settings.llm_provider === "local" && (
              <LocalModelStatus />
            )}
            {(settings.llm_provider === "openai" || settings.llm_provider === "anthropic") && (
              <p className="text-xs text-amber-400 bg-amber-400/10 px-3 py-2 rounded-md mt-2">
                This provider charges per API call. Usage costs are billed directly
                by {settings.llm_provider === "openai" ? "OpenAI" : "Anthropic"} to
                your account. Check their pricing page for current rates.
              </p>
            )}
          </div>

          {settings.llm_provider !== "local" && <div>
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

          {settings.llm_provider !== "local" && <div>
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

function LocalModelStatus() {
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    invoke<boolean>("is_local_llm_downloaded").then(setDownloaded);

    const unlisten = listen<{ progress: number; downloaded_mb: number; total_mb: number }>(
      "phi-download-progress",
      (event) => setProgress(event.payload.progress),
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  if (downloaded) {
    return (
      <p className="text-xs text-green-400 mt-2">
        Phi-4-mini is ready. Prompt structuring works offline.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <p className="text-xs text-neutral-500 mb-2">
        Phi-4-mini (~2.3 GB) runs entirely on your machine. No API key, no internet needed after download.
      </p>
      {downloading ? (
        <div>
          <div className="w-full h-2 bg-neutral-700 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-neutral-500">{progress}%</span>
        </div>
      ) : (
        <button
          onClick={async () => {
            setDownloading(true);
            try {
              await invoke("download_local_llm");
              setDownloaded(true);
            } catch (err) {
              console.error(err);
            } finally {
              setDownloading(false);
            }
          }}
          className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-md transition-colors"
        >
          Download Phi-4-mini (~2.3 GB)
        </button>
      )}
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
