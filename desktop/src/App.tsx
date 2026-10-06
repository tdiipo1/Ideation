import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import StatusIndicator from "./components/StatusIndicator";
import TranscriptView from "./components/TranscriptView";
import ModelDownloader from "./components/ModelDownloader";
import HistoryView from "./components/HistoryView";
import Settings from "./components/Settings";
import ModelNudge from "./components/ModelNudge";
import { useRecording } from "./hooks/useRecording";
import { useModelStatus } from "./hooks/useModelStatus";
import { useT } from "./i18n";

type Tab = "record" | "history" | "settings";
const TAB_KEYS: Record<Tab, string> = {
  record: "tabRecord",
  history: "tabHistory",
  settings: "tabSettings",
};

function App() {
  const {
    state,
    transcript,
    toggle,
    copyToClipboard,
    audioLevel,
    notice,
    detectedLanguage,
    backlogSecs,
    phase,
  } = useRecording();
  const modelStatus = useModelStatus();
  const t = useT();
  const [tab, setTab] = useState<Tab>("record");
  const [historyRefresh, setHistoryRefresh] = useState(0);

  useEffect(() => {
    const unlisten = listen("shortcut-toggle", () => {
      toggle();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [toggle]);

  useEffect(() => {
    if (transcript) {
      setHistoryRefresh((prev) => prev + 1);
    }
  }, [transcript]);

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between px-6 pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Ideation</h1>
        <span className="text-xs text-neutral-500">Ctrl+Shift+Space</span>
      </header>

      <div className="flex gap-1 px-6 mb-4">
        {(["record", "history", "settings"] as Tab[]).map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
              tab === name
                ? "bg-neutral-800 text-white"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
            }`}
          >
            {t(TAB_KEYS[name])}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col px-6 pb-6 gap-4 overflow-hidden">
        {tab === "record" && (
          <>
            <ModelDownloader />
            <ModelNudge />
            <StatusIndicator
              state={state}
              onToggle={toggle}
              modelStatus={modelStatus}
              backlogSecs={backlogSecs}
              phase={phase}
            />
            {notice && state === "idle" && (
              <p className="text-xs text-neutral-500 text-center">{t(notice.key, notice.subs)}</p>
            )}
            <TranscriptView
              transcript={transcript}
              onCopy={copyToClipboard}
              isProcessing={state === "processing"}
              isRecording={state === "recording"}
              audioLevel={audioLevel}
              detectedLanguage={detectedLanguage}
              backlogSecs={backlogSecs}
            />
          </>
        )}
        {tab === "history" && (
          <div className="flex-1 overflow-y-auto">
            <HistoryView refreshTrigger={historyRefresh} />
          </div>
        )}
        {tab === "settings" && (
          <div className="flex-1 overflow-y-auto">
            <Settings />
          </div>
        )}
      </div>

      <footer className="text-xs text-neutral-600 text-center pb-3">{t("footerHint")}</footer>
    </div>
  );
}

export default App;
