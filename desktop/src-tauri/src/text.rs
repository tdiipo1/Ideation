//! Script-aware text assembly shared by the streaming worker and the tail:
//! seam de-duplication, no-space-script joining and hallucination filtering.
//! Mirrors extension/src/lib/transcript.ts.

/// Characters from scripts that are written without word spaces: Han
/// (Chinese / kanji), Hiragana, Katakana and Thai. Hangul is not included —
/// Korean uses spaces.
pub fn is_no_space_char(c: char) -> bool {
    matches!(
        c as u32,
        0x3400..=0x4DBF        // CJK Extension A
        | 0x4E00..=0x9FFF      // CJK Unified Ideographs
        | 0xF900..=0xFAFF      // CJK Compatibility Ideographs
        | 0x20000..=0x2EBEF    // CJK Extensions B–F
        | 0x3040..=0x309F      // Hiragana
        | 0x30A0..=0x30FF      // Katakana
        | 0x31F0..=0x31FF      // Katakana Phonetic Extensions
        | 0x0E00..=0x0E7F      // Thai
    )
}

/// True when at least half of the letters belong to a no-space script.
pub fn is_no_space_script(s: &str) -> bool {
    let mut letters = 0usize;
    let mut no_space = 0usize;
    for c in s.chars() {
        if !c.is_alphabetic() {
            continue;
        }
        letters += 1;
        if is_no_space_char(c) {
            no_space += 1;
        }
    }
    letters > 0 && no_space * 2 >= letters
}

fn norm_word(w: &str) -> String {
    w.chars()
        .filter(|c| c.is_alphanumeric() || *c == '\'')
        .collect::<String>()
        .to_lowercase()
}

fn norm_chars(s: &str) -> Vec<char> {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Character-level seam join for no-space scripts: find the longest run of
/// letters/digits (≤16) that ends `a` and starts `b`, drop it from `b`, and
/// concatenate without a separator.
fn join_chars_with_dedup(a: &str, b: &str, aggressive: bool) -> String {
    let a_n = norm_chars(a);
    let b_n = norm_chars(b);
    let max_k = 16usize.min(a_n.len()).min(b_n.len());
    let min_k = if aggressive { 2 } else { 5 };

    let mut drop = 0usize;
    let mut k = max_k;
    while k >= min_k && k > 0 {
        if a_n[a_n.len() - k..] == b_n[..k] {
            drop = k;
            break;
        }
        k -= 1;
    }

    // Walk `b` until `drop` letters/digits have been consumed.
    let mut consumed = 0usize;
    let mut started = false;
    let mut rest = String::new();
    for c in b.chars() {
        if !started {
            if consumed < drop {
                if c.is_alphanumeric() {
                    consumed += 1;
                }
                continue;
            }
            started = true;
        }
        rest.push(c);
    }
    let rest = rest.trim_start_matches(|c: char| {
        c.is_whitespace() || matches!(c, ',' | '，' | '、' | '。')
    });
    if rest.is_empty() {
        a.to_string()
    } else {
        format!("{}{}", a, rest)
    }
}

/// Join a new segment onto the committed transcript, removing duplicated
/// words at the seam. After a forced cut the next segment re-hears an
/// overlap, so a 1-word match is enough (`aggressive`); otherwise require
/// ≥3 matching words so legitimate repetition is never eaten.
pub fn join_with_dedup(committed: &str, next: &str, aggressive: bool) -> String {
    let a = committed.trim();
    let b = next.trim();
    if a.is_empty() {
        return b.to_string();
    }
    if b.is_empty() {
        return a.to_string();
    }

    let a_ns = is_no_space_script(a);
    let b_ns = is_no_space_script(b);
    if a_ns && b_ns {
        return join_chars_with_dedup(a, b, aggressive);
    }
    // Script switch at the seam (e.g. Chinese → an English term): nothing to
    // dedup, just keep a space between the scripts.
    if a_ns != b_ns {
        return format!("{} {}", a, b);
    }

    let a_words: Vec<&str> = a.split_whitespace().collect();
    let b_words: Vec<&str> = b.split_whitespace().collect();
    let max_k = 8usize.min(a_words.len()).min(b_words.len());
    let min_k = if aggressive { 1 } else { 3 };

    let mut drop = 0;
    let mut k = max_k;
    while k >= min_k && k > 0 {
        let mut matches = true;
        for i in 0..k {
            let wa = norm_word(a_words[a_words.len() - k + i]);
            let wb = norm_word(b_words[i]);
            if wa.is_empty() || wa != wb {
                matches = false;
                break;
            }
        }
        if matches {
            drop = k;
            break;
        }
        k -= 1;
    }

    let rest = b_words[drop..].join(" ");
    if rest.is_empty() {
        a.to_string()
    } else {
        format!("{} {}", a, rest)
    }
}

fn norm_text(s: &str) -> String {
    let t: String = s
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '\'' || c.is_whitespace())
        .collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Subtitle credits Whisper learned from its training data (already in
/// normalized form). These never come from real speech.
const ALWAYS_DROP: &[&str] = &[
    "amaraorg",
    "字幕由",
    "subtítulos realizados",
    "legendas pela",
    "soustitres réalisés",
    "untertitelung des zdf",
];

/// Phrases Whisper famously invents on silence/breath/noise. Only dropped
/// when the audio was mostly unvoiced — a real "Thank you." is kept.
const HALLUCINATIONS: &[&str] = &[
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
];

/// True when a transcribed segment should be discarded: empty text, a
/// subtitle credit, or a known filler phrase from mostly-silent audio.
pub fn is_hallucination(text: &str, speech_ratio: f32) -> bool {
    let t = norm_text(text);
    if t.is_empty() {
        return true;
    }
    if ALWAYS_DROP.iter().any(|m| t.contains(m)) {
        return true;
    }
    speech_ratio < 0.25 && HALLUCINATIONS.iter().any(|p| norm_text(p) == t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_scripts() {
        assert!(is_no_space_script("我们今天讨论一下这个项目"));
        assert!(is_no_space_script("今日はいい天気ですね"));
        assert!(!is_no_space_script("hello world"));
        assert!(!is_no_space_script("안녕하세요 반갑습니다"));
        // Chinese with a sprinkle of Latin is still a no-space script.
        assert!(is_no_space_script("我们用React做这个"));
    }

    #[test]
    fn joins_words_with_overlap() {
        assert_eq!(
            join_with_dedup("we need to ship this", "to ship this by friday", false),
            "we need to ship this by friday"
        );
        // Fewer than three matching words are not enough without a forced cut.
        assert_eq!(
            join_with_dedup("we need to ship this", "ship this by friday", false),
            "we need to ship this ship this by friday"
        );
        assert_eq!(
            join_with_dedup("I said very", "very good", false),
            "I said very very good"
        );
        assert_eq!(join_with_dedup("I said very", "very good", true), "I said very good");
    }

    #[test]
    fn joins_cjk_without_spaces() {
        assert_eq!(
            join_with_dedup("我们今天讨论一下这个项目的", "这个项目的时间表。", true),
            "我们今天讨论一下这个项目的时间表。"
        );
        assert_eq!(join_with_dedup("第一句话。", "第二句话。", false), "第一句话。第二句话。");
        assert_eq!(join_with_dedup("我们用", "React hooks", false), "我们用 React hooks");
    }

    #[test]
    fn filters_hallucinations() {
        assert!(is_hallucination("", 1.0));
        assert!(is_hallucination("Thank you.", 0.1));
        assert!(!is_hallucination("Thank you.", 0.8));
        assert!(is_hallucination("Subtítulos realizados por la comunidad de Amara.org", 0.9));
        assert!(is_hallucination("字幕由Amara.org社区提供", 0.9));
        assert!(is_hallucination("谢谢观看", 0.1));
        assert!(!is_hallucination("谢谢观看", 0.6));
    }
}
