import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ModelStatus {
  /** "idle" | "loading" | "ready" | "error" | "missing" */
  state: string;
  model: string;
  gpu: boolean;
  message: string | null;
}

/**
 * Tracks the backend's Whisper model load state. The app preloads the model
 * at startup and after a model switch; until it is ready the record button
 * shows "Loading model…" instead of silently paying the load cost on the
 * first recording.
 */
export function useModelStatus(): ModelStatus | null {
  const [status, setStatus] = useState<ModelStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<ModelStatus>("get_model_status")
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    const unlisten = listen<ModelStatus>("model-status", (event) => {
      setStatus(event.payload);
    });
    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  return status;
}
