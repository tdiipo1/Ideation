import { useState, useEffect, useRef } from "react";
import { useWhisper } from "../hooks/useWhisper";
import { useRecording } from "../hooks/useRecording";
import { useHistory } from "../hooks/useHistory";
import { useSettings } from "../hooks/useSettings";
import { copyToClipboard } from "../lib/clipboard";
import { insertIntoPage } from "../lib/insert";
import { healTranscript } from "../lib/healing";
import { structurePrompt } from "../lib/structuring";
import { saveSettings } from "../lib/storage";
import { SHARED_GEMINI_KEY } from "../types";
import {
  BASE_EN,
  BASE_MULTI,
  SMALL_MULTI,
  TINY_EN,
  findModel,
  isMultilingualModel,
  multilingualUpgradeFor,
} from "../lib/models";
import { languageName, uiLanguage } from "../lib/languages";
import ModelStatus from "../components/ModelStatus";
import MicButton from "../components/MicButton";
import TranscriptBox from "../components/TranscriptBox";
import HistoryView from "../components/HistoryView";
import SettingsPanel from "../components/SettingsPanel";
import ShortcutHint from "../components/ShortcutHint";

type Tab = "record" | "history" | "settings";

export default function AppFull() {
  const { settings, loaded: settingsLoaded, update: updateSettings, save: saveSettingsDraft } =
    useSettings();
  const {
    modelState,
    modelProgress,
    error,
    device,
    transcribe,
    transcribeSegment,
    startSession,
    detectedLanguage,
    // Wait for the stored settings so the saved model loads first, instead of
    // the default one and then the saved one.
  } = useWhisper(settingsLoaded ? settings.modelId : null, settings.language);
  const {
    state,
    toggle,
    micError,
    openInTab,
    partialText,
    pendingText,
    backlogSecs,
    audioLevel,
    notice,
  } = useRecording(transcribe, transcribeSegment, startSession);
  const { entries, add, remove, clear } = useHistory();
  const [tab, setTab] = useState<Tab>("record");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [healedTranscript, setHealedTranscript] = useState<string | null>(null);
  const [structuredText, setStructuredText] = useState<string | null>(null);
  const [isStructuring, setIsStructuring] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [autoCopied, setAutoCopied] = useState(false);

  // Keyboard shortcut (Alt+R): the service worker relays the command here.
  const toggleRef = useRef<() => void>(() => {});
  useEffect(() => {
    const listener = (
      msg: { type?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (r?: unknown) => void,
    ) => {
      if (msg?.type === "toggle-recording") {
        toggleRef.current();
        sendResponse(true);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function handleToggle() {
    // If starting a new recording, clear current transcript
    if (state === "idle" && transcript) {
      setTranscript(null);
      setHealedTranscript(null);
      setStructuredText(null);
      setStructureError(null);
      setAutoCopied(false);
    }

    const result = await toggle();
    if (result) {
      const raw = result.text;
      const healLang =
        result.language ?? (settings.language !== "auto" ? settings.language : null);
      const healed = settings.healingEnabled ? healTranscript(raw, healLang) : raw;

      setTranscript(raw);
      setHealedTranscript(healed);
      setStructuredText(null);
      setStructureError(null);
      const copied = await copyToClipboard(healed);
      setAutoCopied(copied);
      if (settings.insertIntoPage) {
        insertIntoPage(healed).catch(() => {});
      }

      await add({
        id: String(Date.now()),
        timestamp: Date.now(),
        durationSecs: result.durationSecs,
        raw,
        healed,
      });
    }
  }
  toggleRef.current = handleToggle;

  const ui = uiLanguage();
  const idleReady = modelState === "ready" && state === "idle";

  // One-time nudge for users whose browser isn't in English but who are on
  // an English-only model (existing installs predate the multilingual
  // default). Never a silent download: they choose.
  const multilingualTarget = multilingualUpgradeFor(device);
  const showMultilingualNudge =
    ui !== "en" &&
    !isMultilingualModel(settings.modelId) &&
    !settings.multilingualNudgeDismissed &&
    idleReady;

  function applyMultilingualNudge(accept: boolean) {
    const patch = accept
      ? { modelId: multilingualTarget, multilingualNudgeDismissed: true }
      : { multilingualNudgeDismissed: true };
    updateSettings(patch);
    saveSettings({ ...settings, ...patch });
  }

  // One-time nudge: WebGPU machines handle the next model tier comfortably
  // and it's a clear accuracy upgrade (tiny.en → base.en for English users,
  // Base → Small multilingual for everyone else).
  const gpuUpgradeTarget =
    ui === "en"
      ? settings.modelId === TINY_EN
        ? BASE_EN
        : null
      : settings.modelId === BASE_MULTI
        ? SMALL_MULTI
        : null;
  const showModelNudge =
    !showMultilingualNudge &&
    device === "webgpu" &&
    gpuUpgradeTarget !== null &&
    !settings.modelNudgeDismissed &&
    idleReady;

  function applyModelNudge(accept: boolean) {
    const patch =
      accept && gpuUpgradeTarget
        ? { modelId: gpuUpgradeTarget, modelNudgeDismissed: true }
        : { modelNudgeDismissed: true };
    updateSettings(patch);
    // Persist directly — useSettings.save() reads a ref that may not have
    // caught up with this render yet.
    saveSettings({ ...settings, ...patch });
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
        <ShortcutHint className="text-[10px] text-neutral-600" />
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

          <MicButton
            state={state}
            onToggle={handleToggle}
            disabled={modelState !== "ready"}
            audioLevel={audioLevel}
            backlogSecs={backlogSecs}
          />
          {notice && state === "idle" && !transcript && (
            <p className="text-[10px] text-neutral-500 text-center -mt-2">{notice}</p>
          )}
          {showMultilingualNudge && (
            <div className="bg-neutral-900 rounded-lg p-2.5 border border-blue-900/60 flex flex-col gap-1.5">
              <p className="text-[11px] text-neutral-300">
                Your browser is set to <b>{languageName(ui)}</b>, but the current model only
                understands English. Switch to{" "}
                <b>{findModel(multilingualTarget)?.label ?? "a multilingual model"}</b>?
              </p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => applyMultilingualNudge(true)}
                  className="text-[10px] px-2.5 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                >
                  Switch
                </button>
                <button
                  onClick={() => applyMultilingualNudge(false)}
                  className="text-[10px] px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded transition-colors"
                >
                  Keep English
                </button>
              </div>
            </div>
          )}
          {showModelNudge && gpuUpgradeTarget && (
            <div className="bg-neutral-900 rounded-lg p-2.5 border border-blue-900/60 flex flex-col gap-1.5">
              <p className="text-[11px] text-neutral-300">
                Your device has GPU acceleration — the{" "}
                <b>{findModel(gpuUpgradeTarget)?.label ?? "larger"}</b> model is noticeably
                more accurate and still fast here.
              </p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => applyModelNudge(true)}
                  className="text-[10px] px-2.5 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                >
                  Switch
                </button>
                <button
                  onClick={() => applyModelNudge(false)}
                  className="text-[10px] px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded transition-colors"
                >
                  Keep current
                </button>
              </div>
            </div>
          )}
          <TranscriptBox
            text={state === "idle" ? transcript : partialText}
            healedText={state === "idle" ? healedTranscript : null}
            structuredText={state === "idle" ? structuredText : null}
            isRecording={state === "recording"}
            isProcessing={state === "processing"}
            audioLevel={audioLevel}
            pendingText={pendingText}
            backlogSecs={backlogSecs}
            onCopy={(t) => copyToClipboard(t)}
            onInsert={(t) => insertIntoPage(t)}
            onStructure={handleStructure}
            isStructuring={isStructuring}
            structureError={structureError}
            autoCopied={autoCopied}
            detectedLanguage={detectedLanguage}
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
          <SettingsPanel settings={settings} onUpdate={updateSettings} onSave={saveSettingsDraft} />
        </div>
      )}

      <footer className="text-[10px] text-neutral-700 text-center mt-auto pt-2">
        <ShortcutHint variant="verbose" />
      </footer>
    </div>
  );
}
