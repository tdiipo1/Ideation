import { useState, useEffect, useRef } from "react";
import { useWhisper } from "../hooks/useWhisper";
import { useRecording } from "../hooks/useRecording";
import { copyToClipboard } from "../lib/clipboard";
import { insertIntoPage } from "../lib/insert";
import ModelStatus from "../components/ModelStatus";
import MicButton from "../components/MicButton";
import TranscriptBox from "../components/TranscriptBox";
import ShortcutHint from "../components/ShortcutHint";
import { defaultModelFor } from "../lib/models";
import { uiLanguage } from "../lib/languages";
import { t } from "../lib/i18n";
import {
  EDITION_NAME,
  feedbackUrl,
  openInNewTab,
  ratingUrl,
  recordingCompleted,
  settleRatingNudge,
} from "../lib/feedback";

// Lite has no settings: the model follows the browser language (tiny.en for
// English, Base multilingual otherwise) and the spoken language is detected.
const LITE_MODEL = defaultModelFor(uiLanguage());

export default function AppLite() {
  const {
    modelState,
    modelProgress,
    error,
    transcribe,
    transcribeSegment,
    startSession,
    detectedLanguage,
  } = useWhisper(LITE_MODEL, "auto");
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
  const [transcript, setTranscript] = useState<string | null>(null);
  const [autoCopied, setAutoCopied] = useState(false);
  // One-time "rate it" card, unlocked after a few successful recordings.
  const [ratingNudge, setRatingNudge] = useState(false);

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
    if (state === "idle" && transcript) {
      setTranscript(null);
      setAutoCopied(false);
    }
    const result = await toggle();
    if (result) {
      setTranscript(result.text);
      const copied = await copyToClipboard(result.text);
      setAutoCopied(copied);
      if (await recordingCompleted()) setRatingNudge(true);
    }
  }
  toggleRef.current = handleToggle;

  function answerRatingNudge(rate: boolean) {
    setRatingNudge(false);
    settleRatingNudge();
    if (rate) openInNewTab(ratingUrl());
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold italic text-orange-400">Ideation Lite</h1>
        <ShortcutHint className="text-[10px] text-neutral-600" />
      </header>

      <ModelStatus state={modelState} progress={modelProgress} error={error} accent="orange" />

      {micError === "mic-blocked" && (
        <div className="bg-neutral-900 rounded-lg p-3 border border-orange-800">
          <p className="text-xs text-orange-400 mb-2">{t("micBlockedLite")}</p>
          <button
            onClick={openInTab}
            className="text-xs px-3 py-1.5 bg-orange-600 hover:bg-orange-500 rounded transition-colors"
          >
            {t("openInTab")}
          </button>
        </div>
      )}

      <MicButton
        state={state}
        onToggle={handleToggle}
        disabled={modelState !== "ready"}
        accent="orange"
        audioLevel={audioLevel}
        backlogSecs={backlogSecs}
      />
      {notice && state === "idle" && !transcript && (
        <p className="text-[10px] text-neutral-500 text-center -mt-2">{notice}</p>
      )}
      {ratingNudge && modelState === "ready" && state === "idle" && (
        <div className="bg-neutral-900 rounded-lg p-2.5 border border-orange-900/60 flex flex-col gap-1.5">
          <p className="text-[11px] text-neutral-300">{t("rateTitle", [EDITION_NAME])}</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => answerRatingNudge(true)}
              className="text-[10px] px-2.5 py-1 bg-orange-600 hover:bg-orange-500 rounded transition-colors"
            >
              {t("rate")}
            </button>
            <button
              onClick={() => answerRatingNudge(false)}
              className="text-[10px] px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded transition-colors"
            >
              {t("notNow")}
            </button>
          </div>
        </div>
      )}
      <TranscriptBox
        text={state === "idle" ? transcript : partialText}
        isRecording={state === "recording"}
        isProcessing={state === "processing"}
        audioLevel={audioLevel}
        pendingText={pendingText}
        backlogSecs={backlogSecs}
        onCopy={(t) => copyToClipboard(t)}
        onInsert={(t) => insertIntoPage(t)}
        accent="orange"
        autoCopied={autoCopied}
        detectedLanguage={detectedLanguage}
      />

      <footer className="text-[10px] text-neutral-700 text-center mt-auto pt-2 flex items-center justify-center gap-2">
        <ShortcutHint variant="verbose" />
        <span aria-hidden="true">·</span>
        <a
          href={feedbackUrl()}
          target="_blank"
          rel="noreferrer"
          className="hover:text-neutral-400 transition-colors"
        >
          {t("feedback")}
        </a>
      </footer>
    </div>
  );
}
