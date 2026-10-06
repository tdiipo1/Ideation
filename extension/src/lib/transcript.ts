// Text assembly for streaming transcription: joining committed segments,
// de-duplicating words at overlapped (forced-cut) boundaries, and filtering
// Whisper's well-known silence hallucinations.

function normWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

/**
 * Join a new segment onto the committed transcript. When the previous cut
 * was forced (mid-speech with an overlap re-transcribed), the seam usually
 * repeats a few words — find the longest word overlap between the end of
 * `committed` and the start of `next` and drop it from `next`.
 *
 * `aggressive` should be true only after a forced cut: there we accept a
 * 1-word overlap; otherwise we require ≥3 matching words so legitimate
 * repetition ("very very") is never eaten.
 */
export function joinWithDedup(
  committed: string,
  next: string,
  aggressive: boolean,
): string {
  const a = committed.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;

  const aWords = a.split(/\s+/);
  const bWords = b.split(/\s+/);
  const maxK = Math.min(8, aWords.length, bWords.length);
  const minK = aggressive ? 1 : 3;

  let drop = 0;
  for (let k = maxK; k >= minK; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      const wa = normWord(aWords[aWords.length - k + i]);
      const wb = normWord(bWords[i]);
      if (!wa || wa !== wb) {
        match = false;
        break;
      }
    }
    if (match) {
      drop = k;
      break;
    }
  }

  const rest = bWords.slice(drop).join(" ");
  return rest ? `${a} ${rest}` : a;
}

// Phrases Whisper famously invents on silence/breath/noise (artifacts of its
// YouTube-heavy training data). Only dropped when the audio was mostly
// unvoiced — a real "Thank you." spoken clearly is kept.
const HALLUCINATIONS = new Set([
  "thank you",
  "thanks",
  "thank you very much",
  "thanks for watching",
  "thank you for watching",
  "please subscribe",
  "please like and subscribe",
  "see you in the next video",
  "see you next time",
  "bye",
  "you",
  "so",
]);

/**
 * True when a transcribed segment should be discarded as a hallucination:
 * empty text, or a known hallucination phrase produced from audio that was
 * mostly silence (`speechRatio` < 0.25).
 */
export function isHallucination(text: string, speechRatio: number): boolean {
  const t = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;
  return speechRatio < 0.25 && HALLUCINATIONS.has(t);
}
