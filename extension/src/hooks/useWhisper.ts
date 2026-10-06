import { useState, useEffect, useCallback } from "react";
import type { ModelState } from "../types";

// This hook is a thin proxy over a single Whisper Web Worker (see
// workers/whisper.worker.ts). Model loading and all transcription run inside
// the worker so the popup's main thread stays responsive — essential for the
// live-streaming segments transcribed while recording.

interface ModelProgress {
  status?: string;
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
}

export interface TranscribeOutput {
  text: string;
  /** Language the clip was decoded in (ISO-639-1), when known. */
  language: string | null;
}

export interface TranscribeOpts {
  /** Seconds of voiced audio in the clip; gates the auto-detect lock. */
  voicedSecs?: number;
  /** Receives the growing text of this clip while it is being decoded. */
  onPartial?: (text: string) => void;
}

export type Transcriber = (audio: Float32Array, opts?: TranscribeOpts) => Promise<TranscribeOutput>;

// Module-level singletons so the worker + state survive component remounts
// (the Chrome side panel mounts/unmounts frequently).
let worker: Worker | null = null;
let loadedModel: string | null = null;
let loadedDevice: string | null = null;
let loadedMultilingual = false;
let modelReady = false;
let reqCounter = 0;
// The language setting the next session starts with, and what the current
// session detected/locked.
let sessionLanguageSetting = "auto";
let sessionDetectedLanguage: string | null = null;

const pending = new Map<
  number,
  {
    resolve: (out: TranscribeOutput) => void;
    reject: (err: unknown) => void;
    onPartial?: (text: string) => void;
  }
>();

// Settles when the current model finishes loading (rejects on load failure
// so queued transcriptions fail fast instead of hanging in "processing").
// Reset on each new load.
let readyResolve: (() => void) | null = null;
let readyReject: ((err: Error) => void) | null = null;
let readyPromise: Promise<void> = makeReadyPromise();

function makeReadyPromise(): Promise<void> {
  const p = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Avoid unhandled-rejection noise when nothing is awaiting yet; awaiting
  // callers still receive the rejection.
  p.catch(() => {});
  return p;
}

interface Listener {
  onState: (s: ModelState) => void;
  onProgress: (p: ModelProgress) => void;
  onError: (e: string | null) => void;
  onDevice: (d: string | null) => void;
  onMultilingual: (m: boolean) => void;
  onLanguage: (code: string | null) => void;
}
const listeners = new Set<Listener>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data || {};
    switch (type) {
      case "model-loading":
        listeners.forEach((l) => l.onState("loading"));
        break;
      case "model-progress":
        listeners.forEach((l) => l.onProgress(payload as ModelProgress));
        break;
      case "model-ready": {
        // Ignore a stale "ready" from a model we already moved away from.
        if (payload?.model && payload.model !== loadedModel) break;
        modelReady = true;
        loadedDevice = (payload && payload.device) || null;
        loadedMultilingual = !!payload?.multilingual;
        readyResolve?.();
        listeners.forEach((l) => {
          l.onState("ready");
          l.onError(null);
          l.onDevice(loadedDevice);
          l.onMultilingual(loadedMultilingual);
        });
        break;
      }
      case "model-error": {
        if (payload?.model && payload.model !== loadedModel) break;
        modelReady = false;
        const message = typeof payload === "string" ? payload : String(payload?.message ?? payload);
        readyReject?.(new Error(message));
        listeners.forEach((l) => {
          l.onState("error");
          l.onError(message);
        });
        break;
      }
      case "language-detected":
        sessionDetectedLanguage = payload?.code ?? null;
        listeners.forEach((l) => l.onLanguage(sessionDetectedLanguage));
        break;
      case "partial": {
        const p = pending.get(payload.requestId);
        p?.onPartial?.(payload.text);
        break;
      }
      case "result": {
        const p = pending.get(payload.requestId);
        if (p) {
          pending.delete(payload.requestId);
          p.resolve({ text: payload.text, language: payload.language ?? null });
        }
        break;
      }
      case "error": {
        const p = pending.get(payload.requestId);
        if (p) {
          pending.delete(payload.requestId);
          p.reject(new Error(payload.message));
        }
        break;
      }
      case "log":
        console.log("[Whisper worker]", payload);
        break;
    }
  };
  return worker;
}

function loadModel(model: string) {
  const wk = ensureWorker();
  if (loadedModel === model && modelReady) {
    listeners.forEach((l) => l.onState("ready"));
    return;
  }
  loadedModel = model;
  modelReady = false;
  readyPromise = makeReadyPromise();
  wk.postMessage({ type: "load", payload: { model } });
}

async function postTranscribe(
  audio: Float32Array,
  segment: boolean,
  opts: TranscribeOpts = {},
): Promise<TranscribeOutput> {
  const wk = ensureWorker();
  if (!modelReady) await readyPromise;
  const requestId = ++reqCounter;
  // Copy the (possibly sub-array) audio into its own buffer and transfer it
  // to the worker to avoid a structured-clone copy.
  const buf = audio.slice();
  return new Promise<TranscribeOutput>((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onPartial: opts.onPartial });
    wk.postMessage(
      {
        type: segment ? "transcribe-segment" : "transcribe",
        payload: {
          audio: buf,
          requestId,
          voicedSecs: opts.voicedSecs ?? 0,
          wantPartial: !!opts.onPartial,
        },
      },
      [buf.buffer],
    );
  });
}

/** Begin a recording session: resets the detected language and tells the worker the language policy. */
function startSession(): void {
  sessionDetectedLanguage = null;
  listeners.forEach((l) => l.onLanguage(null));
  ensureWorker().postMessage({
    type: "session-start",
    payload: { language: sessionLanguageSetting },
  });
}

/** The language detected/locked in the current session, readable outside React. */
export function getSessionLanguage(): string | null {
  return sessionDetectedLanguage;
}

/**
 * @param modelId Whisper model to load, or null to wait (e.g. until settings are read).
 * @param language "auto" or an ISO-639-1 code for the next recording session.
 */
export function useWhisper(modelId: string | null, language: string = "auto") {
  const [modelState, setModelState] = useState<ModelState>("not-loaded");
  const [modelProgress, setModelProgress] = useState<ModelProgress>({});
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<string | null>(loadedDevice);
  const [multilingual, setMultilingual] = useState<boolean>(loadedMultilingual);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(sessionDetectedLanguage);

  useEffect(() => {
    sessionLanguageSetting = language || "auto";
  }, [language]);

  useEffect(() => {
    const listener: Listener = {
      onState: setModelState,
      onProgress: setModelProgress,
      onError: setError,
      onDevice: setDevice,
      onMultilingual: setMultilingual,
      onLanguage: setDetectedLanguage,
    };
    listeners.add(listener);

    if (modelId === null) {
      setModelState("not-loaded");
    } else if (loadedModel === modelId && modelReady) {
      setModelState("ready");
      setError(null);
      setDevice(loadedDevice);
      setMultilingual(loadedMultilingual);
    } else {
      setModelState("loading");
      setError(null);
      setModelProgress({});
      loadModel(modelId);
    }

    return () => {
      listeners.delete(listener);
    };
  }, [modelId]);

  // Final (full-clip) transcription used at stop.
  const transcribe = useCallback<Transcriber>(
    (audio, opts) => postTranscribe(audio, false, opts),
    [],
  );

  // Streaming-segment transcription used while recording.
  const transcribeSegment = useCallback<Transcriber>(
    (audio, opts) => postTranscribe(audio, true, opts),
    [],
  );

  const startSessionCb = useCallback(() => startSession(), []);

  return {
    modelState,
    modelProgress,
    error,
    device,
    multilingual,
    detectedLanguage,
    transcribe,
    transcribeSegment,
    startSession: startSessionCb,
  };
}
