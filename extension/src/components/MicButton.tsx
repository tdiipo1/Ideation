import type { RecordingState } from "../types";

interface MicButtonProps {
  state: RecordingState;
  onToggle: () => void;
  disabled?: boolean;
  accent?: "blue" | "orange";
}

const accents = {
  blue: { idle: "bg-blue-500 hover:bg-blue-600 shadow-blue-500/30", copy: "bg-blue-600 hover:bg-blue-500" },
  orange: { idle: "bg-orange-500 hover:bg-orange-600 shadow-orange-500/30", copy: "bg-orange-600 hover:bg-orange-500" },
};

export default function MicButton({ state, onToggle, disabled, accent = "blue" }: MicButtonProps) {
  const colors = accents[accent];
  const isRecording = state === "recording";
  const isProcessing = state === "processing";

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <button
        onClick={onToggle}
        disabled={disabled || isProcessing}
        className={`
          w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200
          ${isRecording
            ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 animate-pulse"
            : isProcessing
              ? "bg-yellow-500 cursor-not-allowed opacity-70"
              : disabled
                ? "bg-neutral-700 cursor-not-allowed opacity-50"
                : `${colors.idle} shadow-lg hover:scale-105`
          }
        `}
      >
        {isRecording ? (
          <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : isProcessing ? (
          <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        )}
      </button>
      <p className="text-xs text-neutral-500">
        {isRecording
          ? "Recording... Click to stop"
          : isProcessing
            ? "Transcribing..."
            : disabled
              ? "Waiting for model..."
              : "Click to record"}
      </p>
    </div>
  );
}
