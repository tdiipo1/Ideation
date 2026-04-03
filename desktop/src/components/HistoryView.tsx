import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

interface HistoryEntry {
  id: string;
  timestamp: string;
  duration_secs: number;
  raw: string;
  healed: string;
}

interface HistoryViewProps {
  refreshTrigger: number;
}

export default function HistoryView({ refreshTrigger }: HistoryViewProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const loadHistory = useCallback(async () => {
    const data = await invoke<HistoryEntry[]>("get_history", {
      limit: 50,
      offset: 0,
    });
    setEntries(data);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, refreshTrigger]);

  async function handleCopy(entry: HistoryEntry) {
    await writeText(showRaw ? entry.raw : entry.healed);
  }

  async function handleDelete(id: string) {
    await invoke("delete_history_entry", { id });
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (expanded === id) setExpanded(null);
  }

  async function handleClear() {
    await invoke("clear_history");
    setEntries([]);
    setExpanded(null);
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-neutral-500 text-sm">No transcripts yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-neutral-400">
          History ({entries.length})
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
          >
            {showRaw ? "Healed" : "Raw"}
          </button>
          <button
            onClick={handleClear}
            className="text-xs px-2 py-1 text-red-400 hover:text-red-300 hover:bg-neutral-800 rounded transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto max-h-[400px]">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden"
          >
            <button
              onClick={() =>
                setExpanded(expanded === entry.id ? null : entry.id)
              }
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-neutral-800/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-neutral-500 shrink-0">
                  {entry.timestamp}
                </span>
                <span className="text-xs text-neutral-600 shrink-0">
                  {entry.duration_secs.toFixed(1)}s
                </span>
                <span className="text-xs text-neutral-400 truncate">
                  {(showRaw ? entry.raw : entry.healed).slice(0, 60)}
                  {(showRaw ? entry.raw : entry.healed).length > 60
                    ? "..."
                    : ""}
                </span>
              </div>
              <svg
                className={`w-3 h-3 text-neutral-500 shrink-0 transition-transform ${expanded === entry.id ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {expanded === entry.id && (
              <div className="px-3 pb-3 border-t border-neutral-800">
                <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap mt-2 mb-2">
                  {showRaw ? entry.raw : entry.healed}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopy(entry)}
                    className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="text-xs px-3 py-1 text-red-400 hover:text-red-300 hover:bg-neutral-800 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
