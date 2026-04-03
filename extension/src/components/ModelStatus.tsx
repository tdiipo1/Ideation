import type { ModelState } from "../types";

interface ModelStatusProps {
  state: ModelState;
  progress: { status?: string; progress?: number; file?: string };
  error: string | null;
  accent?: "blue" | "orange";
}

export default function ModelStatus({ state, progress, error, accent = "blue" }: ModelStatusProps) {
  const barColor = accent === "orange" ? "bg-orange-500" : "bg-blue-500";
  if (state === "ready") return null;

  return (
    <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
      {state === "loading" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-neutral-400">
              {progress.status === "download"
                ? `Downloading model...`
                : "Loading model..."}
            </span>
            {progress.progress != null && (
              <span className="text-xs text-neutral-500">
                {Math.round(progress.progress)}%
              </span>
            )}
          </div>
          {progress.progress != null && (
            <div className="w-full h-1.5 bg-neutral-700 rounded-full overflow-hidden">
              <div
                className={`h-full ${barColor} transition-all duration-200`}
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          )}
        </div>
      )}
      {state === "not-loaded" && (
        <p className="text-xs text-neutral-500">Initializing model...</p>
      )}
      {state === "error" && (
        <p className="text-xs text-red-400">
          Model failed to load: {error || "Unknown error"}
        </p>
      )}
    </div>
  );
}
