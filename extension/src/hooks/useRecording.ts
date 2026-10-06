import { useState, useCallback, useRef, useEffect } from "react";
import { startCapture, AudioCapture } from "../lib/audio";
import { findCutPoint, hasSpeech, speechRatio, normalizeGain, OVERLAP_SAMPLES } from "../lib/vad";
import { joinWithDedup, isHallucination } from "../lib/transcript";
import type { RecordingState } from "../types";

interface RecordingResult {
  text: string;
  durationSecs: number;
}

// How often to check the growing audio buffer for a chunk to transcribe.
const POLL_MS = 1000;

export function useRecording(
  onTranscribe: (audio: Float32Array) => Promise<string>,
  onTranscribeSegment: (audio: Float32Array) => Promise<string> = onTranscribe,
) {
  const [state, setState] = useState<RecordingState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [partialText, setPartialText] = useState<string | null>(null);
  // Smoothed mic input level (0..1) for the live meter.
  const [audioLevel, setAudioLevel] = useState(0);
  // One-shot user-facing notice, e.g. "No speech detected".
  const [notice, setNotice] = useState<string | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const mountedRef = useRef<boolean>(true);
  const levelRef = useRef(0);

  // Streaming state: cursor = samples already transcribed; committed = text so
  // far; busy = a segment is currently being transcribed (single-in-flight).
  const cursorRef = useRef<number>(0);
  const committedRef = useRef<string>("");
  const prevForcedRef = useRef<boolean>(false);
  const inflightRef = useRef<Promise<void> | null>(null);
  const pollRef = useRef<number | null>(null);
  // True while startCapture() is awaited, so a fast double-click can't open a
  // second mic stream and orphan the first one.
  const startingRef = useRef<boolean>(false);

  // Request mic permission on mount so the prompt appears early
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (stream) => {
        stream.getTracks().forEach((t) => t.stop());
      },
      () => {
        // Permission denied or dismissed — will handle when user clicks record
      },
    );
  }, []);

  // Cleanup on unmount: stop any active recording, close AudioContext
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (captureRef.current) {
        try {
          captureRef.current.stop();
        } catch (e) {
          console.warn("Error stopping capture on unmount:", e);
        }
        captureRef.current = null;
      }
    };
  }, []);

  // Transcribe one committed segment in the background, advancing the cursor
  // and the live partial transcript. Guarded so only one runs at a time.
  const pumpSegment = useCallback(() => {
    if (inflightRef.current || !captureRef.current) return;
    const region = captureRef.current.getRange(cursorRef.current);
    normalizeGain(region);
    const cut = findCutPoint(region);
    if (!cut) return;

    const segment = region.subarray(0, cut.index);
    const wasForced = prevForcedRef.current;
    const promise = (async () => {
      try {
        const text = await onTranscribeSegment(segment);
        if (!isHallucination(text, speechRatio(segment))) {
          committedRef.current = joinWithDedup(committedRef.current, text, wasForced);
          if (mountedRef.current) setPartialText(committedRef.current);
        }
        // On a forced cut, back the cursor up so the next segment re-hears
        // the split word; joinWithDedup removes the repeated words.
        cursorRef.current += cut.forced
          ? Math.max(1, cut.index - OVERLAP_SAMPLES)
          : cut.index;
        prevForcedRef.current = cut.forced;
      } catch (err) {
        // Skip this segment on failure; it stays in the un-committed region
        // and will be folded into the next cut or the final tail.
        console.warn("Segment transcription failed:", err);
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = promise;
  }, [onTranscribeSegment]);

  const toggle = useCallback(async (): Promise<RecordingResult | null> => {
    if (state === "processing") return null;

    if (state === "recording") {
      setState("processing");
      setAudioLevel(0);
      // Yield so the UI re-renders before the tail inference kicks off.
      await new Promise((r) => setTimeout(r, 0));

      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      // Wait for any in-flight segment so we never run two inferences
      // concurrently and the cursor is final before we take the tail.
      if (inflightRef.current) {
        try {
          await inflightRef.current;
        } catch {
          /* already handled in pumpSegment */
        }
      }

      const capture = captureRef.current!;
      capture.stop(); // stops the mic; captured samples stay readable
      const durationSecs = capture.totalSamples() / 16000;
      const tail = capture.getRange(cursorRef.current);
      normalizeGain(tail);
      captureRef.current = null;

      let finalText = committedRef.current;
      try {
        if (hasSpeech(tail)) {
          const tailText = await onTranscribe(tail);
          if (!isHallucination(tailText, speechRatio(tail))) {
            finalText = joinWithDedup(finalText, tailText, prevForcedRef.current);
          }
        }
      } catch (err) {
        console.error("Transcription failed:", err);
        // Fall through with whatever was committed during recording.
      } finally {
        cursorRef.current = 0;
        committedRef.current = "";
        prevForcedRef.current = false;
      }

      if (mountedRef.current) setState("idle");
      finalText = finalText.trim();
      if (!finalText) {
        // Nothing intelligible — don't clobber the user's clipboard or
        // pollute history with an empty entry.
        if (mountedRef.current) setNotice("No speech detected");
        return null;
      }
      return { text: finalText, durationSecs };
    } else {
      if (startingRef.current) return null;
      startingRef.current = true;
      try {
        setMicError(null);
        setNotice(null);
        setPartialText(null);
        cursorRef.current = 0;
        committedRef.current = "";
        prevForcedRef.current = false;
        levelRef.current = 0;
        captureRef.current = await startCapture((rms) => {
          // Fast attack, slow decay — reads naturally on a meter.
          levelRef.current = Math.max(
            Math.min(rms * 4, 1),
            levelRef.current * 0.82,
          );
          if (mountedRef.current) setAudioLevel(levelRef.current);
        });
        setState("recording");
        pollRef.current = window.setInterval(pumpSegment, POLL_MS);
      } catch (err) {
        const errMsg = String(err);
        console.error("Mic access failed:", err);
        if (errMsg.includes("NotAllowed") || errMsg.includes("Permission")) {
          setMicError("mic-blocked");
        } else {
          setMicError(errMsg);
        }
      } finally {
        startingRef.current = false;
      }
      return null;
    }
  }, [state, onTranscribe, pumpSegment]);

  const openInTab = useCallback(() => {
    // Open the popup page as a full tab where mic permissions work reliably
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
  }, []);

  return { state, toggle, micError, openInTab, partialText, audioLevel, notice };
}
