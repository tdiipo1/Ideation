import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { languageName } from "../lib/languages";

interface TranscriptResult {
  raw: string;
  healed: string;
  duration_secs: number;
}

interface TranscriptViewProps {
  transcript: TranscriptResult | null;
  onCopy: (useHealed: boolean) => void;
  isProcessing: boolean;
  isRecording: boolean;
  audioLevel?: number;
  /** Language detected/locked for the current or last recording. */
  detectedLanguage?: string | null;
  /** Seconds of captured audio the backend hasn't transcribed yet. */
  backlogSecs?: number;
}

function LanguageChip({ code }: { code: string | null | undefined }) {
  const name = languageName(code);
  if (!name) return null;
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 whitespace-nowrap"
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

function LevelBars({ level }: { level: number }) {
  return (
    <div className="flex items-end gap-1 h-6" aria-hidden="true">
      {BAR_FACTORS.map((f, i) => (
        <div
          key={i}
          className="w-1 rounded-full bg-blue-400 transition-all duration-100"
          style={{ height: `${Math.max(15, Math.min(100, level * f * 130))}%` }}
        />
      ))}
    </div>
  );
}

type ViewMode = "healed" | "raw" | "structured";

export default function TranscriptView({
  transcript,
  onCopy,
  isProcessing,
  isRecording,
  audioLevel = 0,
  detectedLanguage = null,
  backlogSecs = 0,
}: TranscriptViewProps) {
  const behind = Math.round(backlogSecs);
  const [viewMode, setViewMode] = useState<ViewMode>("healed");
  const [structured, setStructured] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Live partial transcript streamed from the backend while recording.
  const [partial, setPartial] = useState<string | null>(null);

  // Listen for streaming chunks from Ollama (accumulate)
  useEffect(() => {
    const unlisten = listen<string>("structuring-chunk", (event) => {
      setStreamingText((prev) => (prev || "") + event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Accumulate the live partial transcript emitted during recording. The
  // backend sends the full accumulated text each time, so we replace.
  useEffect(() => {
    const unlisten = listen<string>("transcript-partial", (event) => {
      setPartial(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Clear the live partial when a new recording starts.
  useEffect(() => {
    if (isRecording) setPartial(null);
  }, [isRecording]);

  // Live-caption segments: each newly committed chunk animates in word by
  // word; previously rendered segments stay static.
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const prevLiveRef = useRef("");
  const segSeqRef = useRef(0);
  const liveScrollRef = useRef<HTMLDivElement | null>(null);
  const showLive = isRecording || isProcessing;

  useEffect(() => {
    if (!showLive) {
      prevLiveRef.current = "";
      setSegments([]);
      return;
    }
    const text = partial || "";
    const prev = prevLiveRef.current;
    if (!text) {
      if (prev) setSegments([]);
      prevLiveRef.current = "";
      return;
    }
    if (text === prev) return;
    if (prev && text.startsWith(prev)) {
      const added = text.slice(prev.length);
      if (added.trim()) {
        setSegments((s) => [...s, { id: ++segSeqRef.current, text: added, animate: true }]);
      }
    } else {
      // Full replace (dedup can rewrite the seam) — render without animation
      // except on the very first text.
      setSegments([{ id: ++segSeqRef.current, text, animate: prev === "" }]);
    }
    prevLiveRef.current = text;
  }, [showLive, partial]);

  // Keep the newest words in view as captions stream in.
  useEffect(() => {
    if (showLive && liveScrollRef.current) {
      liveScrollRef.current.scrollTop = liveScrollRef.current.scrollHeight;
    }
  }, [showLive, segments]);

  // Show transient confirmation when the backend auto-copies to the clipboard
  useEffect(() => {
    let timer: number | undefined;
    const unlisten = listen("auto-copied", () => {
      setCopied(true);
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => setCopied(false), 1500);
    });
    return () => {
      unlisten.then((fn) => fn());
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!transcript && !isProcessing && !isRecording) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-neutral-500 text-sm">
          Your transcript will appear here
        </p>
      </div>
    );
  }

  const displayText =
    structuring && streamingText
      ? streamingText
      : viewMode === "structured" && structured
        ? structured
        : viewMode === "raw"
          ? transcript?.raw
          : transcript?.healed;

  async function handleStructure() {
    if (!transcript) return;
    setStructuring(true);
    setStructureError(null);
    setStreamingText(null);
    setViewMode("structured");
    try {
      const result = await invoke<string>("structure_as_prompt", {
        transcript: transcript.healed,
      });
      setStructured(result);
      setStreamingText(null);
    } catch (err) {
      setStructureError(String(err));
      setViewMode("healed");
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
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-400">Transcript</h2>
          {transcript && (
            <span className="text-xs text-neutral-600">
              {transcript.duration_secs.toFixed(1)}s
            </span>
          )}
          <LanguageChip code={detectedLanguage} />
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
              className={`text-xs px-3 py-1 rounded transition-colors ${
                copied ? "bg-green-600" : "bg-blue-600 hover:bg-blue-500"
              }`}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}
      </div>

      <div
        ref={liveScrollRef}
        className="flex-1 bg-neutral-900 rounded-lg p-4 overflow-y-auto border border-neutral-800"
      >
        {showLive ? (
          segments.length > 0 ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {segments.map((seg) =>
                seg.animate ? (
                  seg.text.split(/(\s+)/).map((part, i) =>
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
              <span className="inline-block w-[2px] h-3.5 ml-0.5 align-middle bg-neutral-300 animate-caret" />
            </p>
          ) : isRecording ? (
            <div className="h-full flex flex-col items-center justify-center gap-2">
              <LevelBars level={audioLevel} />
              <p className="text-neutral-400 text-sm">Listening…</p>
            </div>
          ) : (
            <p className="text-neutral-500 text-sm animate-pulse">
              {behind > 1 ? `Transcribing audio… ${behind} s left` : "Transcribing audio..."}
            </p>
          )
        ) : structuring && !streamingText ? (
          <p className="text-neutral-500 text-sm animate-pulse">
            Structuring as prompt...
          </p>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {displayText}
            {structuring && <span className="animate-pulse">|</span>}
          </p>
        )}
      </div>

      {showLive && segments.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          {isRecording ? (
            <>
              <LevelBars level={audioLevel} />
              <span className="text-xs text-neutral-500">
                {behind > 2 ? `Transcribing… (${behind} s behind)` : "Listening…"}
              </span>
            </>
          ) : (
            <span className="text-xs text-neutral-500 animate-pulse">
              {behind > 1 ? `Finishing up… (${behind} s left)` : "Finishing up…"}
            </span>
          )}
        </div>
      )}

      {transcript && !structured && !structuring && !showLive && (
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
