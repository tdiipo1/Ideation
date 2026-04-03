import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

interface TranscriptResult {
  raw: string;
  healed: string;
  duration_secs: number;
}

interface TranscriptViewProps {
  transcript: TranscriptResult | null;
  onCopy: (useHealed: boolean) => void;
  isProcessing: boolean;
}

type ViewMode = "healed" | "raw" | "structured";

export default function TranscriptView({
  transcript,
  onCopy,
  isProcessing,
}: TranscriptViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("healed");
  const [structured, setStructured] = useState<string | null>(null);
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);

  if (!transcript && !isProcessing) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-neutral-500 text-sm">
          Your transcript will appear here
        </p>
      </div>
    );
  }

  const displayText =
    viewMode === "structured" && structured
      ? structured
      : viewMode === "raw"
        ? transcript?.raw
        : transcript?.healed;

  async function handleStructure() {
    if (!transcript) return;
    setStructuring(true);
    setStructureError(null);
    try {
      const result = await invoke<string>("structure_as_prompt", {
        transcript: transcript.healed,
      });
      setStructured(result);
      setViewMode("structured");
    } catch (err) {
      setStructureError(String(err));
    } finally {
      setStructuring(false);
    }
  }

  async function handleCopy() {
    if (viewMode === "structured" && structured) {
      await writeText(structured);
    } else {
      onCopy(viewMode !== "raw");
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-400">Transcript</h2>
          {transcript && (
            <span className="text-xs text-neutral-600">
              {transcript.duration_secs.toFixed(1)}s
            </span>
          )}
        </div>
        {transcript && (
          <div className="flex items-center gap-2">
            {(["healed", "raw", ...(structured ? ["structured"] : [])] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`text-xs px-2 py-1 rounded transition-colors capitalize ${
                  viewMode === m
                    ? "bg-neutral-700 text-white"
                    : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
                }`}
              >
                {m === "structured" ? "Prompt" : m}
              </button>
            ))}
            <button
              onClick={handleCopy}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >
              Copy
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 bg-neutral-900 rounded-lg p-4 overflow-y-auto border border-neutral-800">
        {isProcessing ? (
          <p className="text-neutral-500 text-sm animate-pulse">
            Transcribing audio...
          </p>
        ) : structuring ? (
          <p className="text-neutral-500 text-sm animate-pulse">
            Structuring as prompt...
          </p>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {displayText}
          </p>
        )}
      </div>

      {transcript && !structured && !structuring && (
        <button
          onClick={handleStructure}
          className="text-xs px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-md transition-colors self-start"
        >
          Structure as Prompt
        </button>
      )}

      {structureError && (
        <p className="text-xs text-red-400">{structureError}</p>
      )}
    </div>
  );
}
