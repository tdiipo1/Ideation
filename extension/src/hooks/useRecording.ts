import { useState, useCallback, useRef, useEffect } from "react";
import { startCapture, AudioCapture } from "../lib/audio";
import {
  findCutPoint,
  hasSpeech,
  speechRatio,
  normalizeGain,
  setMinSegmentSecs,
  resetMinSegmentSecs,
  OVERLAP_SAMPLES,
} from "../lib/vad";
import { joinWithDedup, isHallucination } from "../lib/transcript";
import type { RecordingState } from "../types";
import type { Transcriber } from "./useWhisper";
import { t } from "../lib/i18n";

export interface RecordingResult {
  text: string;
  durationSecs: number;
  /** Language the recording was transcribed in (ISO-639-1), when known. */
  language: string | null;
}

// How often to check the growing audio buffer for a chunk to transcribe.
const POLL_MS = 250;

export function useRecording(
  onTranscribe: Transcriber,
  onTranscribeSegment: Transcriber = onTranscribe,
  onSessionStart?: () => void,
) {
  const [state, setState] = useState<RecordingState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [partialText, setPartialText] = useState<string | null>(null);
  // Text of the segment currently being decoded, streamed token by token.
  const [pendingText, setPendingText] = useState<string | null>(null);
  // Seconds of captured audio not yet transcribed (shown as "N s behind").
  const [backlogSecs, setBacklogSecs] = useState(0);
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
  const languageRef = useRef<string | null>(null);
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
    if (!captureRef.current) return;
    if (mountedRef.current) {
      setBacklogSecs((captureRef.current.totalSamples() - cursorRef.current) / 16000);
    }
    if (inflightRef.current) return;
    const region = captureRef.current.getRange(cursorRef.current);
    normalizeGain(region);
    const cut = findCutPoint(region);
    if (!cut) return;

    const segment = region.subarray(0, cut.index);
    // Silence (a long pause): nothing to transcribe, just move on. This also
    // keeps the model from inventing text out of breath noise.
    if (!hasSpeech(segment)) {
      cursorRef.current += cut.index;
      prevForcedRef.current = false;
      return;
    }
    const wasForced = prevForcedRef.current;
    const promise = (async () => {
      const started = performance.now();
      try {
        const ratio = speechRatio(segment);
        const out = await onTranscribeSegment(segment, {
          voicedSecs: (ratio * segment.length) / 16000,
          // Context for the decoder; skipped on mostly-silent clips (Whisper
          // echoes prompts over silence).
          prevText: ratio >= 0.25 ? committedRef.current.slice(-200) : "",
          onPartial: (t) => {
            if (mountedRef.current) setPendingText(t);
          },
        });
        if (out.language) languageRef.current = out.language;
        if (!isHallucination(out.text, ratio)) {
          committedRef.current = joinWithDedup(committedRef.current, out.text, wasForced);
          if (mountedRef.current) setPartialText(committedRef.current);
        }
        // Slow device? Make the next segments longer so fewer full-window
        // encoder passes are needed per second of speech.
        const inferenceSecs = (performance.now() - started) / 1000;
        setMinSegmentSecs(inferenceSecs * 1.5);
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
        if (mountedRef.current) setPendingText(null);
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
      if (mountedRef.current) setBacklogSecs(tail.length / 16000);

      let finalText = committedRef.current;
      try {
        if (hasSpeech(tail)) {
          const ratio = speechRatio(tail);
          const out = await onTranscribe(tail, {
            voicedSecs: (ratio * tail.length) / 16000,
            prevText: ratio >= 0.25 ? committedRef.current.slice(-200) : "",
            onPartial: (t) => {
              if (mountedRef.current) setPendingText(t);
            },
          });
          if (out.language) languageRef.current = out.language;
          if (!isHallucination(out.text, ratio)) {
            finalText = joinWithDedup(finalText, out.text, prevForcedRef.current);
          }
        }
      } catch (err) {
        console.error("Transcription failed:", err);
        // Fall through with whatever was committed during recording.
      } finally {
        cursorRef.current = 0;
        committedRef.current = "";
        prevForcedRef.current = false;
        if (mountedRef.current) {
          setPendingText(null);
          setBacklogSecs(0);
        }
      }

      if (mountedRef.current) setState("idle");
      finalText = finalText.trim();
      const language = languageRef.current;
      languageRef.current = null;
      if (!finalText) {
        // Nothing intelligible — don't clobber the user's clipboard or
        // pollute history with an empty entry.
        if (mountedRef.current) setNotice(t("noticeNoSpeech"));
        return null;
      }
      return { text: finalText, durationSecs, language };
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
        languageRef.current = null;
        levelRef.current = 0;
        setPendingText(null);
        setBacklogSecs(0);
        resetMinSegmentSecs();
        onSessionStart?.();
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
  }, [state, onTranscribe, onSessionStart, pumpSegment]);

  const openInTab = useCallback(() => {
    // Open the popup page as a full tab where mic permissions work reliably
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
  }, []);

  return {
    state,
    toggle,
    micError,
    openInTab,
    partialText,
    pendingText,
    backlogSecs,
    audioLevel,
    notice,
  };
}
