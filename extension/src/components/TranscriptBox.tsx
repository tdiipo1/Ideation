import { useState, useEffect, useRef } from "react";
import { languageName } from "../lib/languages";
import { isNoSpaceScript } from "../lib/transcript";

interface TranscriptBoxProps {
  text: string | null;
  healedText?: string | null;
  structuredText?: string | null;
  isRecording?: boolean;
  isProcessing?: boolean;
  audioLevel?: number;
  /** Tokens of the segment being decoded right now (streamed). */
  pendingText?: string | null;
  /** Seconds of captured audio not yet transcribed. */
  backlogSecs?: number;
  onCopy: (text: string) => void;
  onInsert?: (text: string) => Promise<boolean>;
  onStructure?: () => void;
  isStructuring?: boolean;
  structureError?: string | null;
  accent?: "blue" | "orange";
  autoCopied?: boolean;
  /** Language detected/locked for the current or last recording. */
  detectedLanguage?: string | null;
  /** Smart correction (LLM) is still polishing the healed text. */
  correcting?: boolean;
}

function LanguageChip({ code }: { code: string | null | undefined }) {
  const name = languageName(code);
  if (!name) return null;
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 whitespace-nowrap"
      title="Detected language"
    >
      {name}
    </span>
  );
}

interface LiveSegment {
  id: number;
  text: string;
  animate: boolean;
}

// Animated mic-level bars shown while listening. Per-bar multipliers give a
// natural "equalizer" look from a single level value.
const BAR_FACTORS = [0.5, 0.85, 1, 0.7, 0.45];

function LevelBars({ level, accent }: { level: number; accent: "blue" | "orange" }) {
  const color = accent === "orange" ? "bg-orange-400" : "bg-blue-400";
  return (
    <div className="flex items-end gap-1 h-6" aria-hidden="true">
      {BAR_FACTORS.map((f, i) => (
        <div
          key={i}
          className={`w-1 rounded-full ${color} transition-all duration-100`}
          style={{ height: `${Math.max(15, Math.min(100, level * f * 130))}%` }}
        />
      ))}
    </div>
  );
}

export default function TranscriptBox({
  text,
  healedText,
  structuredText,
  isRecording,
  isProcessing,
  audioLevel = 0,
  pendingText = null,
  backlogSecs = 0,
  onCopy,
  onInsert,
  onStructure,
  isStructuring,
  structureError,
  accent = "blue",
  autoCopied = false,
  detectedLanguage = null,
  correcting = false,
}: TranscriptBoxProps) {
  const [viewMode, setViewMode] = useState<"healed" | "raw" | "structured">("healed");
  const [copied, setCopied] = useState(false);
  const [insertState, setInsertState] = useState<"idle" | "ok" | "fail">("idle");
  const copyTimeoutRef = useRef<number | null>(null);
  const insertTimeoutRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Live-caption segments: each newly committed chunk of text animates in
  // word by word; previously rendered segments stay static.
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const prevLiveRef = useRef("");
  const segSeqRef = useRef(0);

  const live = !!isRecording || !!isProcessing;
  const liveText = live ? text || "" : "";
  const pending = live ? (pendingText || "").trim() : "";
  const behind = Math.round(backlogSecs);

  useEffect(() => {
    if (!live) {
      prevLiveRef.current = "";
      setSegments([]);
      return;
    }
    const prev = prevLiveRef.current;
    if (!liveText) {
      if (prev) setSegments([]);
      prevLiveRef.current = "";
      return;
    }
    if (liveText === prev) return;
    if (prev && liveText.startsWith(prev)) {
      const added = liveText.slice(prev.length);
      if (added.trim()) {
        setSegments((s) => [
          ...s,
          { id: ++segSeqRef.current, text: added, animate: true },
        ]);
      }
    } else {
      // Full replace (dedup can rewrite the seam) — render without animation
      // except on the very first text.
      setSegments([{ id: ++segSeqRef.current, text: liveText, animate: prev === "" }]);
    }
    prevLiveRef.current = liveText;
  }, [live, liveText]);

  // Keep the newest words in view as captions stream in.
  useEffect(() => {
    if (live && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [live, segments]);

  // Auto-switch to Prompt view when structuring completes
  useEffect(() => {
    if (structuredText) {
      setViewMode("structured");
    }
  }, [structuredText]);

  // Clear feedback timeouts on unmount to prevent state updates after unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) clearTimeout(copyTimeoutRef.current);
      if (insertTimeoutRef.current !== null) clearTimeout(insertTimeoutRef.current);
    };
  }, []);

  const copyColor = accent === "orange" ? "bg-orange-600 hover:bg-orange-500" : "bg-blue-600 hover:bg-blue-500";
  const structureColor = "bg-purple-600 hover:bg-purple-500";

  // ---- Live view (recording / processing) ----
  if (live) {
    return (
      <div className="flex-1 flex flex-col gap-2">
        <div
          ref={scrollRef}
          className="flex-1 bg-neutral-900 rounded-lg p-3 overflow-y-auto border border-neutral-800 max-h-64 min-h-[8rem]"
        >
          {segments.length > 0 || pending ? (
            <p className="text-xs leading-relaxed whitespace-pre-wrap">
              {segments.map((seg) =>
                seg.animate ? (
                  // Scripts without word spaces animate per character.
                  (isNoSpaceScript(seg.text) ? [...seg.text] : seg.text.split(/(\s+)/)).map(
                    (part, i) =>
                      part.trim() ? (
                        <span
                          key={`${seg.id}-${i}`}
                          className="inline-block animate-word-in"
                          style={{ animationDelay: `${Math.min(i * 30, 450)}ms` }}
                        >
                          {part}
                        </span>
                      ) : (
                        <span key={`${seg.id}-${i}`}>{part}</span>
                      ),
                  )
                ) : (
                  <span key={seg.id}>{seg.text}</span>
                ),
              )}
              {pending && (
                <span className="text-neutral-400">
                  {segments.length > 0 && !isNoSpaceScript(pending) ? " " : ""}
                  {pending}
                </span>
              )}
              <span className="inline-block w-[2px] h-3 ml-0.5 align-middle bg-neutral-300 animate-caret" />
            </p>
          ) : isRecording ? (
            <div className="h-full flex flex-col items-center justify-center gap-2">
              <LevelBars level={audioLevel} accent={accent} />
              <p className="text-neutral-400 text-xs">Listening…</p>
            </div>
          ) : (
            <p className="text-neutral-500 text-xs animate-pulse">
              {behind > 1 ? `Transcribing… ${behind} s left` : "Transcribing…"}
            </p>
          )}
        </div>
        {(segments.length > 0 || pending) && (
          <div className="flex items-center gap-2 px-1">
            {isRecording ? (
              <>
                <LevelBars level={audioLevel} accent={accent} />
                <span className="text-[10px] text-neutral-500">
                  {behind > 2 ? `Transcribing… (${behind} s behind)` : "Listening…"}
                </span>
              </>
            ) : (
              <span className="text-[10px] text-neutral-500 animate-pulse">
                {behind > 1 ? `Finishing up… (${behind} s left)` : "Finishing up…"}
              </span>
            )}
            <span className="ml-auto">
              <LanguageChip code={detectedLanguage} />
            </span>
          </div>
        )}
      </div>
    );
  }

  // ---- Idle view (finished transcript) ----
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
    if (copyTimeoutRef.current !== null) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 1500);
  }

  async function handleInsert() {
    if (!onInsert) return;
    const ok = await onInsert(displayText!);
    setInsertState(ok ? "ok" : "fail");
    if (insertTimeoutRef.current !== null) {
      clearTimeout(insertTimeoutRef.current);
    }
    insertTimeoutRef.current = window.setTimeout(() => {
      setInsertState("idle");
      insertTimeoutRef.current = null;
    }, 2000);
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
          <LanguageChip code={detectedLanguage} />
          {correcting && (
            <span className="text-[10px] text-purple-300 animate-pulse">Polishing with AI…</span>
          )}
        </div>
        <div className="flex gap-1">
          {onInsert && (
            <button
              onClick={handleInsert}
              title="Type the transcript into the focused text field on the current page"
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                insertState === "ok"
                  ? "bg-green-600"
                  : insertState === "fail"
                    ? "bg-neutral-700 text-neutral-300"
                    : "bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
              }`}
            >
              {insertState === "ok"
                ? "Inserted!"
                : insertState === "fail"
                  ? "No field focused"
                  : "Insert"}
            </button>
          )}
          <button
            onClick={handleCopy}
            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
              copied || autoCopied ? "bg-green-600" : copyColor
            }`}
          >
            {copied || autoCopied ? "Copied!" : "Copy"}
          </button>
        </div>
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
