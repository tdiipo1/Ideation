export interface AudioCapture {
  /** Stop the mic and release audio resources. Captured samples stay readable. */
  stop: () => void;
  /**
   * Copy of all samples from `startSample` to the end. Cost is proportional
   * to the requested range, not the whole recording — callers track a cursor
   * so long recordings don't pay O(n²) re-concatenation on every poll.
   */
  getRange: (startSample: number) => Float32Array;
  totalSamples: () => number;
}

export async function startCapture(
  onLevel?: (rms: number) => void,
): Promise<AudioCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);

  const chunks: Float32Array[] = [];
  // Running start offset of each chunk, parallel to `chunks`.
  const offsets: number[] = [];
  let total = 0;

  function pushChunk(data: Float32Array) {
    offsets.push(total);
    chunks.push(data);
    total += data.length;
    if (onLevel) {
      // Cheap RMS on a strided sample — enough for a level meter.
      let sum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] * data[i];
        n++;
      }
      onLevel(Math.sqrt(sum / Math.max(1, n)));
    }
  }

  // Prefer AudioWorklet (audio thread, not deprecated); fall back to
  // ScriptProcessorNode if the worklet module fails to load.
  let workletNode: AudioWorkletNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  try {
    await audioContext.audioWorklet.addModule("/pcm-worklet.js");
    workletNode = new AudioWorkletNode(audioContext, "pcm-capture");
    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      pushChunk(e.data);
    };
    source.connect(workletNode);
    workletNode.connect(audioContext.destination);
  } catch (err) {
    console.warn("[Ideation] AudioWorklet unavailable, using ScriptProcessor:", err);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      pushChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
  }

  return {
    stop: () => {
      try {
        if (workletNode) {
          workletNode.port.onmessage = null;
          workletNode.disconnect();
        }
        processor?.disconnect();
        source.disconnect();
      } catch {
        /* already disconnected */
      }
      stream.getTracks().forEach((t) => t.stop());
      audioContext.close().catch(() => {});
    },
    getRange: (startSample: number) => {
      const start = Math.max(0, startSample);
      if (start >= total) return new Float32Array(0);
      const out = new Float32Array(total - start);
      // Find the first chunk containing `start`, then copy forward.
      let i = 0;
      while (i < chunks.length && offsets[i] + chunks[i].length <= start) i++;
      let written = 0;
      for (; i < chunks.length; i++) {
        const chunk = chunks[i];
        const from = Math.max(0, start - offsets[i]);
        out.set(from > 0 ? chunk.subarray(from) : chunk, written);
        written += chunk.length - from;
      }
      return out;
    },
    totalSamples: () => total,
  };
}
