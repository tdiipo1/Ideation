import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { languageName, uiLanguage } from "../lib/languages";

// One-time banner for users whose system language isn't English but whose
// selected model is English-only (the bundled default). Offers the
// multilingual downloads instead of switching silently.

interface AppSettings {
  whisper_model: string;
  model_nudge_dismissed: boolean;
  [key: string]: unknown;
}

interface ModelInfo {
  name: string;
  label: string;
  filename: string;
  size_mb: number;
  english_only: boolean;
}

export default function MultilingualNudge() {
  const ui = uiLanguage();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (ui === "en") return;
    Promise.all([
      invoke<AppSettings>("get_settings"),
      invoke<ModelInfo[]>("get_available_models"),
    ]).then(([s, m]) => {
      setSettings(s);
      setModels(m);
    });
    const unlisten = listen<{ model: string; progress: number }>(
      "model-download-progress",
      (event) => setProgress(event.payload.progress),
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [ui]);

  if (ui === "en" || hidden || !settings || settings.model_nudge_dismissed) return null;
  const current = models.find((m) => m.filename === settings.whisper_model);
  if (!current || !current.english_only) return null;
  // Offer the two sensible choices: the small download and the best model.
  const options = models.filter((m) => m.name === "base" || m.name === "large-v3-turbo");

  async function choose(model: ModelInfo) {
    if (!settings) return;
    setBusy(model.name);
    setError(null);
    setProgress(0);
    try {
      await invoke("download_model", { modelName: model.name });
      const next = { ...settings, whisper_model: model.filename, model_nudge_dismissed: true };
      await invoke("save_settings", { newSettings: next });
      invoke("preload_model", { filename: model.filename }).catch(() => {});
      setHidden(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    if (!settings) return;
    await invoke("save_settings", {
      newSettings: { ...settings, model_nudge_dismissed: true },
    });
    setHidden(true);
  }

  return (
    <div className="bg-neutral-900 rounded-lg p-4 border border-blue-900/60 flex flex-col gap-2">
      <p className="text-sm text-neutral-300">
        Your system language is <b>{languageName(ui)}</b>, but the current speech model only
        understands English. Download a multilingual model?
      </p>
      {busy ? (
        <div>
          <div className="w-full h-2 bg-neutral-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-neutral-500 mt-1">Downloading… {progress}%</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((m) => (
            <button
              key={m.name}
              onClick={() => choose(m)}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
            >
              {m.label} ({m.size_mb} MB)
            </button>
          ))}
          <button
            onClick={dismiss}
            className="text-xs px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded-md transition-colors"
          >
            Keep English
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
