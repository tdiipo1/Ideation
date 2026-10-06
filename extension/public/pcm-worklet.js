// AudioWorklet processor that captures mono PCM off the main thread and posts
// it to the page in ~2048-sample batches (fewer, larger messages than the
// 128-sample render quantum). Loaded via audioContext.audioWorklet.addModule
// from the extension root, so it must stay plain JS with no imports.
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      this.buffers.push(new Float32Array(channel));
      this.length += channel.length;
      if (this.length >= 2048) {
        const out = new Float32Array(this.length);
        let offset = 0;
        for (const b of this.buffers) {
          out.set(b, offset);
          offset += b.length;
        }
        this.port.postMessage(out, [out.buffer]);
        this.buffers = [];
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PCMCaptureProcessor);
