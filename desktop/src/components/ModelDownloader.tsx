import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ModelInfo {
  name: string;
  filename: string;
  url: string;
  sha256: string;
  size_mb: number;
}

interface DownloadProgress {
  model: string;
  progress: number;
  downloaded_mb: number;
  total_mb: number;
}

export default function ModelDownloader() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadModels();

    const unlistenProgress = listen<DownloadProgress>(
      "model-download-progress",
      (event) => {
        setProgress(event.payload.progress);
      },
    );

    const unlistenComplete = listen<{ model: string }>(
      "model-download-complete",
      (event) => {
        setDownloaded((prev) => ({ ...prev, [event.payload.model]: true }));
        setDownloading(null);
        setProgress(0);
      },
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, []);

  async function loadModels() {
    const available = await invoke<ModelInfo[]>("get_available_models");
    setModels(available);

    const status: Record<string, boolean> = {};
    for (const model of available) {
      status[model.name] = await invoke<boolean>("is_model_downloaded", {
        filename: model.filename,
      });
    }
    setDownloaded(status);
  }

  async function handleDownload(modelName: string) {
    setDownloading(modelName);
    setProgress(0);
    setError(null);
    try {
      await invoke("download_model", { modelName });
    } catch (err) {
      setError(String(err));
      setDownloading(null);
    }
  }

  const hasAnyModel = Object.values(downloaded).some((v) => v);

  if (hasAnyModel) {
    return null; // Don't show if at least one model is ready
  }

  return (
    <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
      <h3 className="text-sm font-semibold mb-2">Setup Required</h3>
      <p className="text-xs text-neutral-400 mb-3">
        Download a Whisper model to enable transcription. The base model is
        recommended for most users.
      </p>

      {models.map((model) => (
        <div
          key={model.name}
          className="flex items-center justify-between py-2"
        >
          <div>
            <span className="text-sm font-medium">{model.name}</span>
            <span className="text-xs text-neutral-500 ml-2">
              {model.size_mb} MB
            </span>
          </div>

          {downloaded[model.name] ? (
            <span className="text-xs text-green-400">Ready</span>
          ) : downloading === model.name ? (
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 bg-neutral-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-neutral-400">{progress}%</span>
            </div>
          ) : (
            <button
              onClick={() => handleDownload(model.name)}
              disabled={downloading !== null}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50 transition-colors"
            >
              Download
            </button>
          )}
        </div>
      ))}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
