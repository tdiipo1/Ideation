import type { ModelState } from "../types";
import { t } from "../lib/i18n";

interface ModelProgress {
  status?: string;
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
}

interface ModelStatusProps {
  state: ModelState;
  progress: ModelProgress;
  error: string | null;
  accent?: "blue" | "orange";
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function shortFileName(file?: string): string {
  if (!file) return "";
  // Strip directory components, keep only the filename
  const parts = file.split("/");
  return parts[parts.length - 1] || file;
}

export default function ModelStatus({ state, progress, error, accent = "blue" }: ModelStatusProps) {
  const barColor = accent === "orange" ? "bg-orange-500" : "bg-blue-500";
  const indeterminateColor = accent === "orange" ? "bg-orange-500/60" : "bg-blue-500/60";

  if (state === "ready") return null;

  // Determine what to display based on the progress payload
  const hasPercent =
    typeof progress.progress === "number" && !isNaN(progress.progress) && progress.progress > 0;
  const hasBytes = typeof progress.loaded === "number" && progress.loaded > 0;
  const hasTotal = typeof progress.total === "number" && progress.total > 0;
  const fileName = shortFileName(progress.file);

  return (
    <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
      {state === "loading" && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-neutral-400">
              {progress.status === "download" || progress.status === "progress"
                ? t("modelDownloading")
                : t("modelLoading")}
            </span>
            {hasPercent && (
              <span className="text-xs text-neutral-500 tabular-nums">
                {Math.round(progress.progress!)}%
              </span>
            )}
            {!hasPercent && hasBytes && hasTotal && (
              <span className="text-xs text-neutral-500 tabular-nums">
                {formatBytes(progress.loaded!)} / {formatBytes(progress.total!)}
              </span>
            )}
            {!hasPercent && hasBytes && !hasTotal && (
              <span className="text-xs text-neutral-500 tabular-nums">
                {formatBytes(progress.loaded!)}
              </span>
            )}
          </div>

          {/* Determinate progress bar */}
          {hasPercent && (
            <div className="w-full h-1.5 bg-neutral-700 rounded-full overflow-hidden">
              <div
                className={`h-full ${barColor} transition-all duration-200`}
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          )}

          {/* Indeterminate animated bar — shown when we know download is
              active but can't compute a percentage (HF CDN often omits
              Content-Length, so transformers.js can't compute progress) */}
          {!hasPercent && (
            <div className="w-full h-1.5 bg-neutral-700 rounded-full overflow-hidden relative">
              <div
                className={`absolute top-0 bottom-0 w-1/3 ${indeterminateColor} rounded-full animate-indeterminate`}
              />
            </div>
          )}

          {fileName && (
            <p className="text-[10px] text-neutral-600 mt-1.5 truncate">{fileName}</p>
          )}

          {!hasBytes && !hasPercent && (
            <p className="text-[10px] text-neutral-600 mt-1.5">{t("modelFirstDownloadHint")}</p>
          )}
        </div>
      )}
      {state === "not-loaded" && (
        <p className="text-xs text-neutral-500">{t("modelInitializing")}</p>
      )}
      {state === "error" && (
        <p className="text-xs text-red-400">{t("modelFailed", [error || t("unknownError")])}</p>
      )}
    </div>
  );
}
