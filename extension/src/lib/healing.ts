const ARTIFACTS = /\[.*?\]|\(.*?\)|♪.*?♪|<\|.*?\|>/g;
const FILLERS = /\b(um|uh|uhm|hmm|hm|er|ah)\b/gi;
const FILLER_PHRASES = /\b(like,|you know,|I mean,)\s*/gi;
const REPEATED = /\b(\w+)\s+\1\b/gi;
const MULTI_SPACE = /\s{2,}/g;

export function healTranscript(raw: string): string {
  let text = raw;
  text = text.replace(ARTIFACTS, "");
  text = text.replace(FILLER_PHRASES, "");
  text = text.replace(FILLERS, "");
  text = text.replace(REPEATED, "$1");
  text = text.replace(MULTI_SPACE, " ");

  // Capitalize first letter of each sentence
  text = text.replace(/(^|[.!?]\s+)([a-z])/g, (_, prefix, char) =>
    prefix + char.toUpperCase(),
  );

  return text.trim();
}
