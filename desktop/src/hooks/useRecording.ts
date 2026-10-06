import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
// Auto-copy is now performed in the Rust backend (see stop_recording) so it
// works even when the main window is hidden. The manual copy button below
// still uses writeText.

type RecordingState = "idle" | "recording" | "processing";

export interface TranscriptResult {
  id: string;
  raw: string;
  healed: string;
  duration_secs: number;
  timestamp: string;
}

export function useRecording() {
  const [state, setState] = useState<RecordingState>("idle");
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  // Smoothed mic input level (0..1) for the live meter.
  const [audioLevel, setAudioLevel] = useState(0);
  // One-shot user-facing notice, e.g. "No speech detected".
  const [notice, setNotice] = useState<string | null>(null);
  // Language the backend detected/locked for the current or last recording.
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);

  useEffect(() => {
    let level = 0;
    const unlistenState = listen<string>("recording-state-changed", (event) => {
      setState(event.payload as RecordingState);
      if (event.payload === "recording") {
        setNotice(null);
        setDetectedLanguage(null);
      }
      if (event.payload !== "recording") {
        level = 0;
        setAudioLevel(0);
      }
    });

    const unlistenTranscript = listen<TranscriptResult>(
      "transcript-ready",
      (event) => {
        setTranscript(event.payload);
      },
    );

    // Fast attack, slow decay — reads naturally on a meter.
    const unlistenLevel = listen<number>("audio-level", (event) => {
      level = Math.max(Math.min(event.payload * 4, 1), level * 0.82);
      setAudioLevel(level);
    });

    const unlistenNoSpeech = listen("no-speech", () => {
      setNotice("No speech detected");
    });

    const unlistenLanguage = listen<{ code: string; name: string }>(
      "language-detected",
      (event) => {
        setDetectedLanguage(event.payload.code);
      },
    );

    // Informational messages from the backend (e.g. a pinned language the
    // current model can't honour).
    const unlistenNotice = listen<string>("notice", (event) => {
      setNotice(event.payload);
    });

    // Any failure between stop and transcript (mic died, model missing,
    // inference error). The backend has already returned to idle.
    const unlistenError = listen<{ code: string; message: string }>(
      "transcribe-error",
      (event) => {
        setNotice(event.payload.message);
      },
    );

    return () => {
      unlistenState.then((fn) => fn());
      unlistenTranscript.then((fn) => fn());
      unlistenLevel.then((fn) => fn());
      unlistenNoSpeech.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenLanguage.then((fn) => fn());
      unlistenNotice.then((fn) => fn());
    };
  }, []);

  const toggle = useCallback(async () => {
    try {
      const newState = await invoke<string>("toggle_recording");
      setState(newState as RecordingState);
    } catch (err) {
      console.error("Toggle recording failed:", err);
    }
  }, []);

  const copyToClipboard = useCallback(
    async (useHealed: boolean = true) => {
      if (transcript) {
        const text = useHealed ? transcript.healed : transcript.raw;
        await writeText(text);
      }
    },
    [transcript],
  );

  return { state, transcript, toggle, copyToClipboard, audioLevel, notice, detectedLanguage };
}
