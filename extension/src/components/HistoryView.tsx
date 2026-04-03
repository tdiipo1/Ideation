import { useState } from "react";
import { copyToClipboard } from "../lib/clipboard";
import type { HistoryEntry } from "../types";

interface HistoryViewProps {
  entries: HistoryEntry[];
  onDelete: (id: string) => void;
  onClear: () => void;
}

export default function HistoryView({ entries, onDelete, onClear }: HistoryViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-neutral-600 text-xs">No transcripts yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-neutral-500">{entries.length} entries</span>
        <button
          onClick={onClear}
          className="text-[10px] px-2 py-0.5 text-red-400 hover:bg-neutral-800 rounded"
        >
          Clear All
        </button>
      </div>

      {entries.map((entry) => {
        const date = new Date(entry.timestamp);
        const time = date.toLocaleString();
        const preview = (entry.healed || entry.raw).slice(0, 50);

        return (
          <div key={entry.id} className="bg-neutral-900 rounded border border-neutral-800">
            <button
              onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-neutral-800/50"
            >
              <span className="text-[10px] text-neutral-600 shrink-0">{time}</span>
              <span className="text-[10px] text-neutral-400 truncate">{preview}...</span>
            </button>

            {expanded === entry.id && (
              <div className="px-2.5 pb-2 border-t border-neutral-800">
                <p className="text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap py-2">
                  {entry.healed || entry.raw}
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => copyToClipboard(entry.healed || entry.raw)}
                    className="text-[10px] px-2 py-0.5 bg-blue-600 hover:bg-blue-500 rounded"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => onDelete(entry.id)}
                    className="text-[10px] px-2 py-0.5 text-red-400 hover:bg-neutral-800 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
