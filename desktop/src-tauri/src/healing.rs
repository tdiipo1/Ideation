/// Basic regex-based transcript healing.
/// This runs before the optional LLM healing step.
pub fn heal_transcript(text: &str) -> String {
    let mut result = text.to_string();

    // Remove common Whisper artifacts
    let artifacts = [
        "[BLANK_AUDIO]",
        "(inaudible)",
        "[inaudible]",
        "(silence)",
        "[silence]",
        "[MUSIC]",
        "[music]",
        "♪",
    ];
    for artifact in &artifacts {
        result = result.replace(artifact, "");
    }

    // Remove filler words at word boundaries
    let fillers = [
        " um ", " uh ", " uhm ", " hmm ", " hm ", " er ", " ah ",
        " like, ", " you know, ", " I mean, ",
    ];
    for filler in &fillers {
        // Case-insensitive replacement
        let lower = result.to_lowercase();
        let filler_lower = filler.to_lowercase();
        while lower.contains(&filler_lower) {
            if let Some(pos) = result.to_lowercase().find(&filler_lower) {
                result.replace_range(pos..pos + filler.len(), " ");
            } else {
                break;
            }
            // Re-check after replacement
            break;
        }
    }

    // Remove repeated words ("the the" -> "the")
    let words: Vec<&str> = result.split_whitespace().collect();
    let mut deduped = Vec::with_capacity(words.len());
    for (i, word) in words.iter().enumerate() {
        if i == 0 || word.to_lowercase() != words[i - 1].to_lowercase() {
            deduped.push(*word);
        }
    }
    result = deduped.join(" ");

    // Capitalize first letter of sentences
    let mut chars: Vec<char> = result.chars().collect();
    let mut capitalize_next = true;
    for c in chars.iter_mut() {
        if capitalize_next && c.is_alphabetic() {
            *c = c.to_uppercase().next().unwrap_or(*c);
            capitalize_next = false;
        }
        if *c == '.' || *c == '!' || *c == '?' {
            capitalize_next = true;
        }
    }
    result = chars.into_iter().collect();

    // Normalize whitespace
    let parts: Vec<&str> = result.split_whitespace().collect();
    result = parts.join(" ");

    result.trim().to_string()
}
