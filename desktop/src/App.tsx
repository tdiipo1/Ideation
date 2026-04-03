import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import StatusIndicator from "./components/StatusIndicator";
import TranscriptView from "./components/TranscriptView";
import ModelDownloader from "./components/ModelDownloader";
import HistoryView from "./components/HistoryView";
import Settings from "./components/Settings";
import { useRecording } from "./hooks/useRecording";

type Tab = "record" | "history" | "settings";

function App() {
  const { state, transcript, toggle, copyToClipboard } = useRecording();
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
        {(["record", "history", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-1.5 rounded-md transition-colors capitalize ${
              tab === t
                ? "bg-neutral-800 text-white"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col px-6 pb-6 gap-4 overflow-hidden">
        {tab === "record" && (
          <>
            <ModelDownloader />
            <StatusIndicator state={state} onToggle={toggle} />
            <TranscriptView
              transcript={transcript}
              onCopy={copyToClipboard}
              isProcessing={state === "processing"}
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

      <footer className="text-xs text-neutral-600 text-center pb-3">
        Press the button or use Ctrl+Shift+Space to start/stop recording
      </footer>
    </div>
  );
}

export default App;
