import type { RecordingState } from "../types";
import { t } from "../lib/i18n";

interface MicButtonProps {
  state: RecordingState;
  onToggle: () => void;
  disabled?: boolean;
  accent?: "blue" | "orange";
  /** Live mic level (0..1) — drives the pulsing ring while recording. */
  audioLevel?: number;
  /** Seconds of audio still to transcribe while processing. */
  backlogSecs?: number;
}

const accents = {
  blue: { idle: "bg-blue-500 hover:bg-blue-600 shadow-blue-500/30", copy: "bg-blue-600 hover:bg-blue-500" },
  orange: { idle: "bg-orange-500 hover:bg-orange-600 shadow-orange-500/30", copy: "bg-orange-600 hover:bg-orange-500" },
};

export default function MicButton({
  state,
  onToggle,
  disabled,
  accent = "blue",
  audioLevel = 0,
  backlogSecs = 0,
}: MicButtonProps) {
  const colors = accents[accent];
  const isRecording = state === "recording";
  const isProcessing = state === "processing";

  const label = isRecording
    ? t("micRecording")
    : isProcessing
      ? backlogSecs > 1
        ? t("micTranscribingLeft", [Math.round(backlogSecs)])
        : t("micTranscribing")
      : disabled
        ? t("micWaitingModel")
        : t("micClickToRecord");

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div className="relative w-20 h-20">
        {/* Voice-reactive ring: scales with the live mic level so the user
            can see the mic is hearing them before any captions appear. */}
        {isRecording && (
          <div
            className="absolute inset-0 rounded-full bg-red-500/25 transition-transform duration-100 pointer-events-none"
            style={{ transform: `scale(${1 + audioLevel * 0.45})` }}
          />
        )}
      <button
        onClick={onToggle}
        disabled={disabled || isProcessing}
        className={`
          relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200
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
      </div>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  );
}
