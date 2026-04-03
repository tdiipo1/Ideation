import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

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

  useEffect(() => {
    const unlistenState = listen<string>("recording-state-changed", (event) => {
      setState(event.payload as RecordingState);
    });

    const unlistenTranscript = listen<TranscriptResult>(
      "transcript-ready",
      (event) => {
        setTranscript(event.payload);
      },
    );

    const unlistenAutoCopy = listen<string>("auto-copy", async (event) => {
      await writeText(event.payload);
    });

    return () => {
      unlistenState.then((fn) => fn());
      unlistenTranscript.then((fn) => fn());
      unlistenAutoCopy.then((fn) => fn());
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

  return { state, transcript, toggle, copyToClipboard };
}
