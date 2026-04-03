import { useState } from "react";
import { useWhisper } from "../hooks/useWhisper";
import { useRecording } from "../hooks/useRecording";
import { copyToClipboard } from "../lib/clipboard";
import ModelStatus from "../components/ModelStatus";
import MicButton from "../components/MicButton";
import TranscriptBox from "../components/TranscriptBox";

export default function AppLite() {
  const { modelState, modelProgress, error, transcribe } = useWhisper(
    "onnx-community/whisper-base.en",
  );
  const { state, toggle, micError, openInTab } = useRecording(transcribe);
  const [transcript, setTranscript] = useState<string | null>(null);

  async function handleToggle() {
    if (state === "idle" && transcript) {
      setTranscript(null);
    }
    const result = await toggle();
    if (result) {
      setTranscript(result.text);
      await copyToClipboard(result.text);
    }
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold italic text-orange-400">Ideation Lite</h1>
        <span className="text-[10px] text-neutral-600">Alt+I</span>
      </header>

      <ModelStatus state={modelState} progress={modelProgress} error={error} accent="orange" />

      {micError === "mic-blocked" && (
        <div className="bg-neutral-900 rounded-lg p-3 border border-orange-800">
          <p className="text-xs text-orange-400 mb-2">
            Microphone access was blocked. Chrome doesn't show permission prompts in extension popups.
          </p>
          <button
            onClick={openInTab}
            className="text-xs px-3 py-1.5 bg-orange-600 hover:bg-orange-500 rounded transition-colors"
          >
            Open in full tab to grant mic access
          </button>
        </div>
      )}

      <MicButton state={state} onToggle={handleToggle} disabled={modelState !== "ready"} accent="orange" />
      <TranscriptBox
        text={transcript}
        onCopy={(t) => copyToClipboard(t)}
        accent="orange"
      />

      <footer className="text-[10px] text-neutral-700 text-center mt-auto pt-2">
        Alt+I to toggle
      </footer>
    </div>
  );
}
