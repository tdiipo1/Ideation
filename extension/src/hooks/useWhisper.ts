import { useState, useEffect, useRef, useCallback } from "react";
import type { ModelState } from "../types";

// Statically import onnxruntime-web BEFORE transformers.js
// This ensures Vite bundles it locally and Transformers.js
// finds it already loaded instead of fetching from CDN
import * as ort from "onnxruntime-web";
import { pipeline, env as tfEnv } from "@huggingface/transformers";

// Make ort globally available so Transformers.js finds it
(globalThis as Record<string, unknown>).ort = ort;

// Configure for Chrome extension
tfEnv.allowLocalModels = false;
tfEnv.useBrowserCache = true;

// Configure ONNX Runtime for Chrome extension context
if (ort.env?.wasm) {
  ort.env.wasm.numThreads = 1;
}

interface ModelProgress {
  status?: string;
  progress?: number;
  file?: string;
}

let pipelineInstance: Awaited<ReturnType<typeof pipeline>> | null = null;
let loadedModel: string | null = null;

export function useWhisper(modelId: string) {
  const [modelState, setModelState] = useState<ModelState>("not-loaded");
  const [modelProgress, setModelProgress] = useState<ModelProgress>({});
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (loadingRef.current) return;
    if (pipelineInstance && loadedModel === modelId) {
      setModelState("ready");
      return;
    }

    loadingRef.current = true;
    setModelState("loading");

    (async () => {
      try {
        pipelineInstance = await pipeline(
          "automatic-speech-recognition",
          modelId,
          {
            dtype: "q8",
            device: "wasm",
            progress_callback: (p: Record<string, unknown>) => {
              setModelProgress(p as ModelProgress);
            },
          },
        );
        loadedModel = modelId;
        setModelState("ready");
      } catch (err) {
        setModelState("error");
        setError(String(err));
        console.error("Model load error:", err);
      } finally {
        loadingRef.current = false;
      }
    })();
  }, [modelId]);

  const transcribe = useCallback(
    async (audio: Float32Array): Promise<string> => {
      if (!pipelineInstance) throw new Error("Model not loaded");
      // English-only models (.en) don't accept language/task params
      const isEnglishOnly = loadedModel?.endsWith(".en");
      const options: Record<string, unknown> = {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      };
      if (!isEnglishOnly) {
        options.language = "english";
        options.task = "transcribe";
      }
      const result = await (pipelineInstance as CallableFunction)(audio, options);
      return (result as { text: string }).text;
    },
    [],
  );

  return { modelState, modelProgress, error, transcribe };
}
