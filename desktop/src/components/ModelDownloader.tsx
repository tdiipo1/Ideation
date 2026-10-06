import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface DownloadProgress {
  model: string;
  progress: number;
}

export default function ModelDownloader() {
  const [ready, setReady] = useState(true); // Assume ready (model is bundled)
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if the default model is available
    invoke<boolean>("is_model_downloaded", { filename: "ggml-base.en.bin" }).then(
      (downloaded) => setReady(downloaded),
    );

    const unlisten = listen<DownloadProgress>("model-download-progress", (event) => {
      setProgress(event.payload.progress);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  if (ready) return null;

  // Fallback: if bundled model extraction failed, offer download
  return (
    <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
      <h3 className="text-sm font-semibold mb-2">Downloading Speech Model</h3>
      <p className="text-xs text-neutral-400 mb-3">
        One-time download of the Whisper model for transcription (~142 MB).
      </p>
      {downloading ? (
        <div>
          <div className="w-full h-2 bg-neutral-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-neutral-500 mt-1">{progress}%</span>
        </div>
      ) : (
        <button
          onClick={async () => {
            setDownloading(true);
            setError(null);
            try {
              await invoke("download_model", { modelName: "base.en" });
              setReady(true);
            } catch (err) {
              setError(String(err));
              setDownloading(false);
            }
          }}
          className="text-xs px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
        >
          Download Now
        </button>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
