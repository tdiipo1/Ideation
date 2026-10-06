// Text assembly for streaming transcription: joining committed segments,
// de-duplicating words at overlapped (forced-cut) boundaries, and filtering
// Whisper's well-known silence hallucinations.
//
// Script-aware: Chinese, Japanese and Thai have no word spaces, so for those
// the seam logic works on characters and joins without a separator. Korean
// uses spaces and takes the word path. Mirrors desktop/src-tauri/src/text.rs.

const NO_SPACE_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
const LETTER = /\p{L}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** True when at least half of the letters belong to a script written without spaces. */
export function isNoSpaceScript(s: string): boolean {
  let letters = 0;
  let noSpace = 0;
  for (const ch of s) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (NO_SPACE_CHAR.test(ch)) noSpace++;
  }
  return letters > 0 && noSpace * 2 >= letters;
}

function normWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

function normChars(s: string): string[] {
  const out: string[] = [];
  for (const ch of s.toLowerCase()) if (LETTER_OR_DIGIT.test(ch)) out.push(ch);
  return out;
}

/**
 * Character-level seam join for no-space scripts: find the longest run of
 * letters/digits (≤16) that ends `a` and starts `b`, drop it from `b`, and
 * concatenate without a separator.
 */
function joinCharsWithDedup(a: string, b: string, aggressive: boolean): string {
  const aN = normChars(a);
  const bN = normChars(b);
  const maxK = Math.min(16, aN.length, bN.length);
  const minK = aggressive ? 2 : 5;

  let drop = 0;
  for (let k = maxK; k >= minK; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      if (aN[aN.length - k + i] !== bN[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      drop = k;
      break;
    }
  }

  // Walk `b` by code point until `drop` letters/digits have been consumed.
  const chars = [...b];
  let i = 0;
  let consumed = 0;
  while (consumed < drop && i < chars.length) {
    if (LETTER_OR_DIGIT.test(chars[i])) consumed++;
    i++;
  }
  const rest = chars.slice(i).join("").replace(/^[\s,，、。]+/u, "");
  return rest ? a + rest : a;
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

  const aNoSpace = isNoSpaceScript(a);
  const bNoSpace = isNoSpaceScript(b);
  if (aNoSpace && bNoSpace) return joinCharsWithDedup(a, b, aggressive);
  // Script switch at the seam (e.g. Chinese → an English term): nothing to
  // dedup, just keep a space between the scripts.
  if (aNoSpace !== bNoSpace) return `${a} ${b}`;

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

function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Subtitle credits Whisper learned from its training data. These never come
// from real speech, so they are dropped no matter how voiced the audio was.
const ALWAYS_DROP = [
  "amara.org",
  "字幕由",
  "subtítulos realizados",
  "legendas pela",
  "sous-titres réalisés",
  "untertitelung des zdf",
].map(normText);

// Phrases Whisper famously invents on silence/breath/noise (artifacts of its
// YouTube-heavy training data). Only dropped when the audio was mostly
// unvoiced — a real "Thank you." spoken clearly is kept.
const HALLUCINATIONS = new Set(
  [
    // en
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
    // es
    "gracias por ver",
    "gracias",
    "suscríbete",
    "hasta la próxima",
    // pt
    "obrigado por assistir",
    "obrigado",
    "inscreva-se",
    // fr
    "merci d'avoir regardé",
    "à bientôt",
    // de
    "vielen dank",
    "bis zum nächsten mal",
    // zh
    "谢谢观看",
    "谢谢大家",
    "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
    // ja
    "ご視聴ありがとうございました",
    "チャンネル登録お願いします",
    // ko
    "시청해주셔서 감사합니다",
    // ru
    "продолжение следует",
    "субтитры сделал",
  ].map(normText),
);

/**
 * True when a transcribed segment should be discarded as a hallucination:
 * empty text, a subtitle credit, or a known filler phrase produced from
 * audio that was mostly silence (`speechRatio` < 0.25).
 */
export function isHallucination(text: string, speechRatio: number): boolean {
  const t = normText(text);
  if (!t) return true;
  if (ALWAYS_DROP.some((m) => t.includes(m))) return true;
  return speechRatio < 0.25 && HALLUCINATIONS.has(t);
}
