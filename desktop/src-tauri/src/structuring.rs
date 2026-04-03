use serde::{Deserialize, Serialize};

const SYSTEM_PROMPT: &str = r#"You are a prompt structuring assistant. The user recorded their thoughts by speaking out loud. Your job is to restructure their raw spoken transcript into a clear, well-organized prompt that can be sent to an AI assistant.

Rules:
- Preserve ALL meaning, intent, and details from the original
- Do NOT add information that wasn't in the transcript
- Organize into clear sections with headers if the content covers multiple topics
- Use bullet points for lists of items or requirements
- Fix grammar and remove filler words
- Make it concise but complete
- If the user was describing a task they want done, frame it as clear instructions
- If the user was brainstorming, organize the ideas logically
- Output ONLY the structured prompt, no meta-commentary"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub provider: String, // "openai", "anthropic", "groq"
    pub api_key: String,
    pub model: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: String,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Deserialize)]
struct GeminiPart {
    text: String,
}

pub async fn structure_prompt(config: &LlmConfig, transcript: &str) -> Result<String, String> {
    let client = reqwest::Client::new();

    match config.provider.as_str() {
        "gemini" => call_gemini(&client, config, transcript).await,
        "openai" => call_openai(&client, config, transcript).await,
        "anthropic" => call_anthropic(&client, config, transcript).await,
        "groq" => call_groq(&client, config, transcript).await,
        _ => Err(format!("Unknown provider: {}", config.provider)),
    }
}

async fn call_openai(
    client: &reqwest::Client,
    config: &LlmConfig,
    transcript: &str,
) -> Result<String, String> {
    let model = config
        .model
        .as_deref()
        .unwrap_or("gpt-4o-mini");

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": transcript}
        ],
        "temperature": 0.3
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI error {}: {}", status, text));
    }

    let data: OpenAiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

    data.choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "No response from OpenAI".to_string())
}

async fn call_anthropic(
    client: &reqwest::Client,
    config: &LlmConfig,
    transcript: &str,
) -> Result<String, String> {
    let model = config
        .model
        .as_deref()
        .unwrap_or("claude-sonnet-4-20250514");

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "system": SYSTEM_PROMPT,
        "messages": [
            {"role": "user", "content": transcript}
        ]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &config.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Anthropic error {}: {}", status, text));
    }

    let data: AnthropicResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

    data.content
        .first()
        .map(|c| c.text.clone())
        .ok_or_else(|| "No response from Anthropic".to_string())
}

async fn call_groq(
    client: &reqwest::Client,
    config: &LlmConfig,
    transcript: &str,
) -> Result<String, String> {
    let model = config
        .model
        .as_deref()
        .unwrap_or("llama-3.1-8b-instant");

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": transcript}
        ],
        "temperature": 0.3
    });

    // Groq uses OpenAI-compatible API
    let resp = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Groq request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Groq error {}: {}", status, text));
    }

    let data: OpenAiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Groq response: {}", e))?;

    data.choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "No response from Groq".to_string())
}

async fn call_gemini(
    client: &reqwest::Client,
    config: &LlmConfig,
    transcript: &str,
) -> Result<String, String> {
    let model = config
        .model
        .as_deref()
        .unwrap_or("gemini-2.0-flash-lite");

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, config.api_key
    );

    let body = serde_json::json!({
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": transcript}]}],
        "generationConfig": {"temperature": 0.3}
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini error {}: {}", status, text));
    }

    let data: GeminiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

    data.candidates
        .first()
        .and_then(|c| c.content.parts.first())
        .map(|p| p.text.clone())
        .ok_or_else(|| "No response from Gemini".to_string())
}
