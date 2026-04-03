import { useState, useEffect } from "react";

interface TranscriptBoxProps {
  text: string | null;
  healedText?: string | null;
  structuredText?: string | null;
  onCopy: (text: string) => void;
  onStructure?: () => void;
  isStructuring?: boolean;
  structureError?: string | null;
  accent?: "blue" | "orange";
}

export default function TranscriptBox({
  text,
  healedText,
  structuredText,
  onCopy,
  onStructure,
  isStructuring,
  structureError,
  accent = "blue",
}: TranscriptBoxProps) {
  const [viewMode, setViewMode] = useState<"healed" | "raw" | "structured">("healed");
  const [copied, setCopied] = useState(false);

  // Auto-switch to Prompt view when structuring completes
  useEffect(() => {
    if (structuredText) {
      setViewMode("structured");
    }
  }, [structuredText]);

  const copyColor = accent === "orange" ? "bg-orange-600 hover:bg-orange-500" : "bg-blue-600 hover:bg-blue-500";
  const structureColor = "bg-purple-600 hover:bg-purple-500";

  if (!text) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-neutral-600 text-xs">Your transcript will appear here</p>
      </div>
    );
  }

  const hasHealed = healedText && healedText !== text;
  const hasStructured = !!structuredText;

  const displayText =
    viewMode === "structured" && structuredText
      ? structuredText
      : viewMode === "raw"
        ? text
        : healedText || text;

  function handleCopy() {
    onCopy(displayText!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex-1 flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="flex gap-1">
          {hasHealed && (
            <>
              <button
                onClick={() => setViewMode("healed")}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${viewMode === "healed" ? "bg-neutral-700 text-white" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"}`}
              >
                Healed
              </button>
              <button
                onClick={() => setViewMode("raw")}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${viewMode === "raw" ? "bg-neutral-700 text-white" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"}`}
              >
                Raw
              </button>
            </>
          )}
          {hasStructured && (
            <button
              onClick={() => setViewMode("structured")}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${viewMode === "structured" ? "bg-purple-700 text-white" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"}`}
            >
              Prompt
            </button>
          )}
        </div>
        <button
          onClick={handleCopy}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            copied ? "bg-green-600" : copyColor
          }`}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="flex-1 bg-neutral-900 rounded-lg p-3 overflow-y-auto border border-neutral-800 max-h-64">
        {isStructuring ? (
          <p className="text-neutral-500 text-xs animate-pulse">Structuring as prompt...</p>
        ) : (
          <p className="text-xs leading-relaxed whitespace-pre-wrap">{displayText}</p>
        )}
      </div>

      {onStructure && !structuredText && !isStructuring && (
        <button
          onClick={onStructure}
          className={`text-[10px] px-3 py-1.5 ${structureColor} rounded transition-colors self-start`}
        >
          Structure as Prompt
        </button>
      )}

      {structureError && (
        <p className="text-[10px] text-red-400">{structureError}</p>
      )}
    </div>
  );
}
