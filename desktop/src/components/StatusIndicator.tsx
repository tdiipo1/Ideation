import type { ModelStatus } from "../hooks/useModelStatus";

interface StatusIndicatorProps {
  state: "idle" | "recording" | "processing";
  onToggle: () => void;
  /** Backend model load state; recording waits for "ready". */
  modelStatus?: ModelStatus | null;
  /** Seconds of audio still to transcribe while processing. */
  backlogSecs?: number;
  /** "idle" | "transcribing" | "polishing" */
  phase?: string;
}

export default function StatusIndicator({
  state,
  onToggle,
  modelStatus = null,
  backlogSecs = 0,
  phase = "idle",
}: StatusIndicatorProps) {
  const isRecording = state === "recording";
  const isProcessing = state === "processing";
  const modelLoading = modelStatus?.state === "loading";
  const modelProblem = modelStatus?.state === "error" || modelStatus?.state === "missing";
  const behind = Math.round(backlogSecs);

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={onToggle}
        disabled={isProcessing || (modelLoading && !isRecording)}
        className={`
          w-24 h-24 rounded-full flex items-center justify-center
          transition-all duration-200 ease-in-out
          ${
            isRecording
              ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 animate-pulse"
              : isProcessing
                ? "bg-yellow-500 cursor-not-allowed opacity-70"
                : modelLoading
                  ? "bg-neutral-700 cursor-not-allowed opacity-60"
                  : "bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/30 hover:scale-105"
          }
        `}
      >
        {isRecording ? (
          <svg
            className="w-10 h-10 text-white"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : isProcessing ? (
          <svg
            className="w-10 h-10 text-white animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          <svg
            className="w-10 h-10 text-white"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        )}
      </button>

      <p className="text-sm font-medium">
        {isRecording
          ? "Recording... Click or press shortcut to stop"
          : isProcessing
            ? phase === "polishing"
              ? "Polishing with AI…"
              : behind > 1
                ? `Finishing up… ${behind} s left`
                : "Processing audio..."
            : modelLoading
              ? "Loading speech model…"
              : "Click or press Ctrl+Shift+Space to record"}
      </p>
      {modelProblem && !isRecording && !isProcessing && (
        <p className="text-xs text-amber-400 text-center">
          {modelStatus?.state === "missing"
            ? "Speech model not downloaded — pick one in Settings."
            : `Model failed to load: ${modelStatus?.message ?? "unknown error"}`}
        </p>
      )}
      {modelStatus?.state === "ready" && modelStatus.gpu && state === "idle" && (
        <p className="text-[10px] text-neutral-600">GPU acceleration active</p>
      )}
    </div>
  );
}
