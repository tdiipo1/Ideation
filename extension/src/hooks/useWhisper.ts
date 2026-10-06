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

// Module-level singletons so the worker + state survive component remounts
// (the Chrome side panel mounts/unmounts frequently).
let worker: Worker | null = null;
let loadedModel: string | null = null;
let loadedDevice: string | null = null;
let modelReady = false;
let reqCounter = 0;

const pending = new Map<
  number,
  { resolve: (text: string) => void; reject: (err: unknown) => void }
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
      case "model-ready":
        modelReady = true;
        loadedDevice = (payload && payload.device) || null;
        readyResolve?.();
        listeners.forEach((l) => {
          l.onState("ready");
          l.onError(null);
          l.onDevice(loadedDevice);
        });
        break;
      case "model-error":
        modelReady = false;
        readyReject?.(new Error(String(payload)));
        listeners.forEach((l) => {
          l.onState("error");
          l.onError(String(payload));
        });
        break;
      case "result": {
        const p = pending.get(payload.requestId);
        if (p) {
          pending.delete(payload.requestId);
          p.resolve(payload.text);
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
): Promise<string> {
  const wk = ensureWorker();
  if (!modelReady) await readyPromise;
  const requestId = ++reqCounter;
  // Copy the (possibly sub-array) audio into its own buffer and transfer it
  // to the worker to avoid a structured-clone copy.
  const buf = audio.slice();
  return new Promise<string>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    wk.postMessage(
      {
        type: segment ? "transcribe-segment" : "transcribe",
        payload: { audio: buf, requestId },
      },
      [buf.buffer],
    );
  });
}

export function useWhisper(modelId: string) {
  const [modelState, setModelState] = useState<ModelState>("not-loaded");
  const [modelProgress, setModelProgress] = useState<ModelProgress>({});
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<string | null>(loadedDevice);

  useEffect(() => {
    const listener: Listener = {
      onState: setModelState,
      onProgress: setModelProgress,
      onError: setError,
      onDevice: setDevice,
    };
    listeners.add(listener);

    if (loadedModel === modelId && modelReady) {
      setModelState("ready");
      setError(null);
      setDevice(loadedDevice);
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
  const transcribe = useCallback(
    (audio: Float32Array) => postTranscribe(audio, false),
    [],
  );

  // Streaming-segment transcription used while recording.
  const transcribeSegment = useCallback(
    (audio: Float32Array) => postTranscribe(audio, true),
    [],
  );

  return { modelState, modelProgress, error, device, transcribe, transcribeSegment };
}
