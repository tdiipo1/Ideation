import { useState, useCallback, useRef, useEffect } from "react";
import { startCapture, AudioCapture } from "../lib/audio";
import type { RecordingState } from "../types";

interface RecordingResult {
  text: string;
  durationSecs: number;
}

export function useRecording(
  onTranscribe: (audio: Float32Array) => Promise<string>,
) {
  const [state, setState] = useState<RecordingState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const startTimeRef = useRef<number>(0);

  // Request mic permission on mount so the prompt appears early
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (stream) => {
        // Permission granted — stop the stream immediately, we just needed the permission
        stream.getTracks().forEach((t) => t.stop());
      },
      () => {
        // Permission denied or dismissed — will handle when user clicks record
      },
    );
  }, []);

  const toggle = useCallback(async (): Promise<RecordingResult | null> => {
    if (state === "processing") return null;

    if (state === "recording") {
      setState("processing");
      const audio = captureRef.current!.stop();
      captureRef.current = null;
      const durationSecs = (Date.now() - startTimeRef.current) / 1000;

      try {
        const text = await onTranscribe(audio);
        setState("idle");
        return { text, durationSecs };
      } catch (err) {
        console.error("Transcription failed:", err);
        setState("idle");
        return null;
      }
    } else {
      try {
        setMicError(null);
        captureRef.current = await startCapture();
        startTimeRef.current = Date.now();
        setState("recording");
      } catch (err) {
        const errMsg = String(err);
        console.error("Mic access failed:", err);
        if (errMsg.includes("NotAllowed") || errMsg.includes("Permission")) {
          setMicError("mic-blocked");
        } else {
          setMicError(errMsg);
        }
      }
      return null;
    }
  }, [state, onTranscribe]);

  const openInTab = useCallback(() => {
    // Open the popup page as a full tab where mic permissions work reliably
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
  }, []);

  return { state, toggle, micError, openInTab };
}
