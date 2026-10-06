// Rule-based transcript healing: strip Whisper artifacts, remove filler
// words, collapse stutters, fix sentence capitalization.
//
// Language-aware: filler lists are applied only for languages we know, and
// the word-level rules are skipped for scripts without spaces (Chinese,
// Japanese, Thai) where "words" and "case" don't apply.
// Mirrors desktop/src-tauri/src/healing.rs.

import { isNoSpaceScript } from "./transcript";

const BRACKET_ARTIFACTS = /\[[^\]]*\]|♪[^♪]*♪|<\|[^|]*\|>/g;
// Only known non-speech annotations are removed; a spoken "(see below)"
// must survive.
const PAREN_ARTIFACTS =
  /\((?:inaudible|silence|music|laughs?|laughter|applause|noise|unintelligible|música|risas|aplausos|musique|rires|musik|lachen)\)|（(?:音乐|笑声|掌声)）/gi;

// JS `\b` is ASCII-only even in Unicode mode, so word edges are expressed
// with lookarounds so that "äh" or "euh" match too.
function wordRe(alternatives: string[]): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}'])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}'])[,.]?\\s*`,
    "giu",
  );
}

const FILLERS: Record<string, RegExp> = {
  en: wordRe(["um+", "uh+", "uhm", "hmm+", "hm", "ah", "erm"]),
  es: wordRe(["eh", "ehm", "em"]),
  pt: wordRe(["eh", "ehm", "em"]),
  fr: wordRe(["euh", "hum"]),
  de: wordRe(["äh", "ähm"]),
  zh: /[嗯呃]+[，,]?/g,
  ja: /(?:えーと|えっと|あのー|えー)[、,]?/g,
};
const FILLER_PHRASES_EN = /(?<![\p{L}\p{N}'])(?:like,|you know,|I mean,)\s*/giu;

// "I I I think" → "I think". Doubles are left alone ("very very").
const TRIPLE_REPEAT = /(?<![\p{L}\p{N}])(\p{L}+)(?:\s+\1(?![\p{L}\p{N}])){2,}/giu;
const MULTI_SPACE = /\s{2,}/g;
const SPACE_BEFORE_PUNCT = /\s+([,.!?;:])/g;
// Capitalize the first letter of the text and after sentence punctuation,
// looking past an opening ¿ or ¡.
const SENTENCE_START = /(^|[.!?]\s+)([¿¡]?)(\p{Ll})/gu;

export function healTranscript(raw: string, lang?: string | null): string {
  let text = raw.replace(BRACKET_ARTIFACTS, "").replace(PAREN_ARTIFACTS, "");
  const noSpace = isNoSpaceScript(text);
  const code = lang ? lang.toLowerCase().slice(0, 2) : null;

  if (code && FILLERS[code]) text = text.replace(FILLERS[code], "");
  if (code === "en") text = text.replace(FILLER_PHRASES_EN, "");

  if (noSpace) {
    text = text.replace(MULTI_SPACE, " ");
  } else {
    text = text.replace(TRIPLE_REPEAT, "$1");
    text = text.replace(MULTI_SPACE, " ").replace(SPACE_BEFORE_PUNCT, "$1");
    text = text.replace(SENTENCE_START, (_, p, q, c: string) => p + q + c.toUpperCase());
  }

  return text.trim();
}
