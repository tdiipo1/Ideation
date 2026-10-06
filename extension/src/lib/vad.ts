// Lightweight energy-based voice-activity detection used to pick chunk
// boundaries for streaming transcription. We want to cut the audio at a
// natural pause (silence) so Whisper never sees a word sliced in half —
// arbitrary mid-word cuts degrade accuracy badly.
//
// This mirrors the Rust implementation in src-tauri/src/audio.rs so both
// frontends segment audio the same way.

const SAMPLE_RATE = 16000;
const FRAME = 480; // 30ms frames at 16kHz
const MIN_SEGMENT_SAMPLES = 3 * SAMPLE_RATE; // don't commit segments shorter than this
const HARD_CAP_SAMPLES = 20 * SAMPLE_RATE; // force a cut beyond this (Whisper's window is 30s)
const SILENCE_SAMPLES = Math.round(0.4 * SAMPLE_RATE); // 400ms of quiet = a pause
const ABS_FLOOR = 0.004; // absolute RMS floor so true silence always counts as silent

// When a cut is forced mid-speech (no pause found), the next segment starts
// this far *before* the cut so a split word keeps context; the resulting
// duplicated words are removed by joinWithDedup (lib/transcript.ts).
export const OVERLAP_SAMPLES = Math.round(0.75 * SAMPLE_RATE);

/**
 * Bring a quiet recording up to a usable level before VAD and inference.
 * Peak-based and capped so background noise isn't blown up. Mutates in place.
 */
export function normalizeGain(audio: Float32Array): void {
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    const a = Math.abs(audio[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0.001 && peak < 0.05) {
    const gain = Math.min(0.3 / peak, 10);
    for (let i = 0; i < audio.length; i++) audio[i] *= gain;
  }
}

export interface CutPoint {
  /** Sample index relative to the start of the region passed in. */
  index: number;
  /** True when the cut was forced at the hard cap instead of at a pause. */
  forced: boolean;
}

function frameRms(audio: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += audio[i] * audio[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

/**
 * Find a point to commit the given un-committed region up to, or null if
 * it's not yet time to cut a segment. The region should start at the
 * caller's cursor (samples already transcribed are excluded).
 */
export function findCutPoint(region: Float32Array): CutPoint | null {
  const len = region.length;
  if (len < MIN_SEGMENT_SAMPLES) return null;

  // Establish a noise floor relative to the loudest frame in the region.
  let peak = 0;
  for (let s = 0; s + FRAME <= len; s += FRAME) {
    const rms = frameRms(region, s, s + FRAME);
    if (rms > peak) peak = rms;
  }
  const threshold = Math.max(ABS_FLOOR, 0.2 * peak);

  // Scan for a silence run that begins at least MIN_SEGMENT_SAMPLES in, so
  // each committed segment carries enough speech for context.
  let runStart = -1;
  let lowestRms = Infinity;
  let lowestSample = -1;
  for (let s = MIN_SEGMENT_SAMPLES; s + FRAME <= len; s += FRAME) {
    const rms = frameRms(region, s, s + FRAME);
    if (rms < lowestRms) {
      lowestRms = rms;
      lowestSample = s;
    }
    if (rms < threshold) {
      if (runStart === -1) runStart = s;
      if (s + FRAME - runStart >= SILENCE_SAMPLES) {
        // Cut at the start of the pause.
        return { index: runStart, forced: false };
      }
    } else {
      runStart = -1;
    }
  }

  // No pause found, but the region is too long — force a cut at the quietest
  // frame so the boundary lands on the least-bad spot.
  if (len >= HARD_CAP_SAMPLES && lowestSample > 0) {
    return { index: lowestSample, forced: true };
  }

  return null;
}

/** Whether the audio contains any frame above the silence floor. */
export function hasSpeech(audio: Float32Array): boolean {
  if (audio.length < FRAME) return false;
  for (let s = 0; s + FRAME <= audio.length; s += FRAME) {
    if (frameRms(audio, s, s + FRAME) >= ABS_FLOOR) return true;
  }
  return false;
}

/**
 * Fraction of frames above the silence floor (0..1). Used to distinguish
 * real speech from breath/noise blips when filtering Whisper's classic
 * silence hallucinations ("Thank you." etc.).
 */
export function speechRatio(audio: Float32Array): number {
  if (audio.length < FRAME) return 0;
  let voiced = 0;
  let frames = 0;
  for (let s = 0; s + FRAME <= audio.length; s += FRAME) {
    if (frameRms(audio, s, s + FRAME) >= ABS_FLOOR) voiced++;
    frames++;
  }
  return frames ? voiced / frames : 0;
}
