import { useState } from "react";
import { useWhisper } from "../hooks/useWhisper";
import { useRecording } from "../hooks/useRecording";
import { useHistory } from "../hooks/useHistory";
import { useSettings } from "../hooks/useSettings";
import { copyToClipboard } from "../lib/clipboard";
import { healTranscript } from "../lib/healing";
import { structurePrompt } from "../lib/structuring";
import { SHARED_GEMINI_KEY } from "../types";
import ModelStatus from "../components/ModelStatus";
import MicButton from "../components/MicButton";
import TranscriptBox from "../components/TranscriptBox";
import HistoryView from "../components/HistoryView";
import SettingsPanel from "../components/SettingsPanel";

type Tab = "record" | "history" | "settings";

export default function AppFull() {
  const { settings, update: updateSettings, save: saveSettings } = useSettings();
  const { modelState, modelProgress, error, transcribe } = useWhisper(settings.modelId);
  const { state, toggle, micError, openInTab } = useRecording(transcribe);
  const { entries, add, remove, clear } = useHistory();
  const [tab, setTab] = useState<Tab>("record");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [healedTranscript, setHealedTranscript] = useState<string | null>(null);
  const [structuredText, setStructuredText] = useState<string | null>(null);
  const [isStructuring, setIsStructuring] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);

  async function handleToggle() {
    // If starting a new recording, clear current transcript
    if (state === "idle" && transcript) {
      setTranscript(null);
      setHealedTranscript(null);
      setStructuredText(null);
      setStructureError(null);
    }

    const result = await toggle();
    if (result) {
      const raw = result.text;
      const healed = settings.healingEnabled ? healTranscript(raw) : raw;

      setTranscript(raw);
      setHealedTranscript(healed);
      setStructuredText(null);
      setStructureError(null);
      await copyToClipboard(healed);

      await add({
        id: String(Date.now()),
        timestamp: Date.now(),
        durationSecs: result.durationSecs,
        raw,
        healed,
      });
    }
  }

  async function handleStructure() {
    if (!healedTranscript && !transcript) return;

    // Resolve the API key: shared key for Gemini, or user's own key
    let apiKey = settings.llmApiKey;
    if (settings.llmProvider === "gemini" && settings.llmKeyMode === "shared") {
      apiKey = SHARED_GEMINI_KEY;
    }
    if (!apiKey) {
      setStructureError("No API key configured. Go to Settings to add one.");
      return;
    }

    setIsStructuring(true);
    setStructureError(null);
    try {
      const result = await structurePrompt(
        {
          provider: settings.llmProvider,
          apiKey,
          model: settings.llmModel || undefined,
        },
        healedTranscript || transcript!,
      );
      setStructuredText(result);
    } catch (err) {
      setStructureError(String(err));
    } finally {
      setIsStructuring(false);
    }
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Ideation</h1>
        <span className="text-[10px] text-neutral-600">Alt+I</span>
      </header>

      <div className="flex gap-1">
        {(["record", "history", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-2.5 py-1 rounded transition-colors capitalize ${
              tab === t
                ? "bg-neutral-800 text-white"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "record" && (
        <>
          <ModelStatus state={modelState} progress={modelProgress} error={error} />

          {micError === "mic-blocked" && (
            <div className="bg-neutral-900 rounded-lg p-3 border border-blue-800">
              <p className="text-xs text-blue-400 mb-2">
                Microphone access was blocked.
              </p>
              <button
                onClick={openInTab}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
              >
                Open in full tab to grant mic access
              </button>
            </div>
          )}

          <MicButton state={state} onToggle={handleToggle} disabled={modelState !== "ready"} />
          <TranscriptBox
            text={transcript}
            healedText={healedTranscript}
            structuredText={structuredText}
            onCopy={(t) => copyToClipboard(t)}
            onStructure={handleStructure}
            isStructuring={isStructuring}
            structureError={structureError}
          />
        </>
      )}

      {tab === "history" && (
        <div className="flex-1 overflow-y-auto">
          <HistoryView entries={entries} onDelete={remove} onClear={clear} />
        </div>
      )}

      {tab === "settings" && (
        <div className="flex-1 overflow-y-auto">
          <SettingsPanel settings={settings} onUpdate={updateSettings} onSave={saveSettings} />
        </div>
      )}

      <footer className="text-[10px] text-neutral-700 text-center mt-auto pt-2">
        Alt+I to toggle
      </footer>
    </div>
  );
}
