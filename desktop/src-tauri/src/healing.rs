//! Rule-based transcript healing: strip Whisper artifacts, remove filler
//! words, collapse stutters, fix sentence capitalization.
//!
//! Language-aware: filler lists are applied only for languages we know, and
//! the word-level rules are skipped for scripts without spaces (Chinese,
//! Japanese, Thai) where "words" and "case" don't apply.
//! Mirrors extension/src/lib/healing.ts.

use crate::text::is_no_space_script;
use regex::Regex;
use std::sync::LazyLock;

static BRACKET_ARTIFACTS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[[^\]]*\]|♪[^♪]*♪|<\|[^|]*\|>").unwrap());
// Only known non-speech annotations are removed; a spoken "(see below)"
// must survive.
static PAREN_ARTIFACTS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\((?:inaudible|silence|music|laughs?|laughter|applause|noise|unintelligible|música|risas|aplausos|musique|rires|musik|lachen)\)|（(?:音乐|笑声|掌声)）",
    )
    .unwrap()
});
// `\b` is Unicode-aware in the regex crate, so "äh" and "euh" get real word edges.
static FILLER_EN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:um+|uh+|uhm|hmm+|hm|ah|erm)\b[,.]?\s*").unwrap());
static FILLER_PHRASES_EN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:like,|you know,|I mean,)\s*").unwrap());
static FILLER_ES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:eh|ehm|em)\b[,.]?\s*").unwrap());
static FILLER_FR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:euh|hum)\b[,.]?\s*").unwrap());
static FILLER_DE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:äh|ähm)\b[,.]?\s*").unwrap());
static FILLER_ZH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[嗯呃]+[，,]?").unwrap());
static FILLER_JA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:えーと|えっと|あのー|えー)[、,]?").unwrap());
static MULTI_SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s{2,}").unwrap());
static SPACE_BEFORE_PUNCT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+([,.!?;:])").unwrap());

/// Heal a raw transcript. `lang` is the ISO-639-1 code the audio was
/// transcribed in, when known; it selects the filler list.
pub fn heal_transcript(text: &str, lang: Option<&str>) -> String {
    let mut result = BRACKET_ARTIFACTS.replace_all(text, "").into_owned();
    result = PAREN_ARTIFACTS.replace_all(&result, "").into_owned();

    let no_space = is_no_space_script(&result);
    let code: Option<String> = lang.map(|l| l.to_lowercase().chars().take(2).collect());

    match code.as_deref() {
        Some("en") => {
            result = FILLER_PHRASES_EN.replace_all(&result, "").into_owned();
            result = FILLER_EN.replace_all(&result, "").into_owned();
        }
        Some("es") | Some("pt") => result = FILLER_ES.replace_all(&result, "").into_owned(),
        Some("fr") => result = FILLER_FR.replace_all(&result, "").into_owned(),
        Some("de") => result = FILLER_DE.replace_all(&result, "").into_owned(),
        Some("zh") => result = FILLER_ZH.replace_all(&result, "").into_owned(),
        Some("ja") => result = FILLER_JA.replace_all(&result, "").into_owned(),
        _ => {}
    }

    if no_space {
        result = MULTI_SPACE.replace_all(&result, " ").into_owned();
    } else {
        result = collapse_triple_repeats(&result);
        result = MULTI_SPACE.replace_all(&result, " ").into_owned();
        result = SPACE_BEFORE_PUNCT.replace_all(&result, "$1").into_owned();
        result = capitalize_sentences(&result);
    }

    result.trim().to_string()
}

fn word_key(w: &str) -> String {
    w.chars()
        .filter(|c| c.is_alphanumeric() || *c == '\'')
        .collect::<String>()
        .to_lowercase()
}

/// "I I I think" → "I think". Doubles are left alone ("very very").
fn collapse_triple_repeats(s: &str) -> String {
    let words: Vec<&str> = s.split_whitespace().collect();
    let mut out: Vec<&str> = Vec::with_capacity(words.len());
    let mut i = 0;
    while i < words.len() {
        let key = word_key(words[i]);
        let mut j = i + 1;
        while j < words.len() && !key.is_empty() && word_key(words[j]) == key {
            j += 1;
        }
        if j - i >= 3 {
            out.push(words[i]);
        } else {
            out.extend_from_slice(&words[i..j]);
        }
        i = j;
    }
    out.join(" ")
}

/// Capitalize the first letter of the text and the first letter after
/// sentence punctuation followed by whitespace (looking past an opening ¿/¡).
/// "3.5 percent" and "e.g." are left alone because no whitespace follows
/// their dots.
fn capitalize_sentences(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut cap_next = true;
    let mut after_terminal = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if after_terminal {
                cap_next = true;
            }
            out.push(c);
            continue;
        }
        if matches!(c, '¿' | '¡') {
            out.push(c);
            continue;
        }
        if cap_next && c.is_alphabetic() {
            out.extend(c.to_uppercase());
            cap_next = false;
            after_terminal = false;
            continue;
        }
        cap_next = false;
        after_terminal = matches!(c, '.' | '!' | '?');
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_english_fillers_and_artifacts() {
        assert_eq!(
            heal_transcript("um, so I think, uh, we should [BLANK_AUDIO] ship it (laughs)", Some("en")),
            "So I think, we should ship it"
        );
        // Spoken parentheticals are kept.
        assert_eq!(heal_transcript("read the docs (see below) first", Some("en")), "Read the docs (see below) first");
    }

    #[test]
    fn keeps_other_languages_intact() {
        // "er" and "um" are real words elsewhere; no English list applied.
        assert_eq!(heal_transcript("er hat um sieben angerufen", Some("de")), "Er hat um sieben angerufen");
        assert_eq!(heal_transcript("eh, ¿qué tal? todo bien.", Some("es")), "¿Qué tal? Todo bien.");
    }

    #[test]
    fn leaves_cjk_alone() {
        assert_eq!(heal_transcript("嗯，我们今天讨论一下这个项目。", Some("zh")), "我们今天讨论一下这个项目。");
        assert_eq!(heal_transcript("我们今天讨论一下。", None), "我们今天讨论一下。");
    }

    #[test]
    fn collapses_stutters_only() {
        assert_eq!(heal_transcript("I I I think it's very very good", Some("en")), "I think it's very very good");
    }

    #[test]
    fn does_not_capitalize_inside_numbers() {
        assert_eq!(heal_transcript("growth was 3.5 percent. nice", Some("en")), "Growth was 3.5 percent. Nice");
    }

    #[test]
    fn survives_unicode_case_changes() {
        // Used to panic: byte offsets from to_lowercase() applied to the original.
        let _ = heal_transcript("İstanbul um İzmir", Some("en"));
    }
}
