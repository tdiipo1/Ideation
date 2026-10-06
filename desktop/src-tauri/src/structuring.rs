use serde::{Deserialize, Serialize};

const SYSTEM_PROMPT: &str = "Restructure the spoken transcript inside <transcript> tags into a clear, organized prompt for an AI assistant. Preserve all meaning and details. Use sections/headers for multiple topics, bullet points for lists. Fix grammar, remove filler words. Write the output in the same language as the transcript; do not translate. Output only the structured prompt.";

/// Delimit user speech so a small model restructures it instead of answering it.
pub fn wrap_transcript(transcript: &str) -> String {
    format!("<transcript>\n{}\n</transcript>", transcript.trim())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub provider: String, // "gemini", "openai", "anthropic", "groq", "local"
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

pub async fn structure_prompt(
    app: &tauri::AppHandle,
    config: &LlmConfig,
    raw_transcript: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let wrapped = wrap_transcript(raw_transcript);
    let transcript = wrapped.as_str();

    match config.provider.as_str() {
        "local" => call_local(app, transcript).await,
        "gemma4" => call_gemma4_local(app, transcript).await,
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
        .unwrap_or("gemini-2.5-flash");

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

// --- Ollama-based local inference ---
// Ollama runs as a background service and auto-detects installed models.
// No manual setup needed — if the user has Ollama installed, it just works.

const OLLAMA_BASE: &str = "http://127.0.0.1:11434";

// Preferred models in order — we pick the first one the user has installed
const PHI_MODELS: &[&str] = &["phi4-mini", "phi4", "phi3", "phi3:mini"];
const GEMMA_MODELS: &[&str] = &["gemma4:e2b", "gemma4", "gemma3", "gemma2"];

/// List all models installed in Ollama
async fn list_ollama_models() -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .get(format!("{}/api/tags", OLLAMA_BASE))
        .send()
        .await
        .map_err(|_| {
            "Ollama is not running. Install it from https://ollama.com and make sure it's started."
                .to_string()
        })?;

    #[derive(Deserialize)]
    struct TagsResponse {
        models: Vec<ModelEntry>,
    }
    #[derive(Deserialize)]
    struct ModelEntry {
        name: String,
    }

    let data: TagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    Ok(data.models.into_iter().map(|m| m.name).collect())
}

/// Find the best matching model from a preference list
fn pick_model(installed: &[String], preferences: &[&str]) -> Option<String> {
    for pref in preferences {
        for installed_name in installed {
            // Match "phi4" against "phi4:latest", "gemma4" against "gemma4:latest", etc.
            let base = installed_name.split(':').next().unwrap_or(installed_name);
            if base == *pref || installed_name == *pref {
                return Some(installed_name.clone());
            }
        }
    }
    None
}

/// Call Ollama with streaming — emits chunks to the frontend for live updates
pub async fn call_ollama_streaming(
    app: &tauri::AppHandle,
    model: &str,
    transcript: &str,
) -> Result<String, String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": transcript}
        ],
        "stream": true,
        "options": {
            "temperature": 0.3,
            "num_predict": 1024
        }
    });

    let resp = client
        .post(format!("{}/api/chat", OLLAMA_BASE))
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            "Ollama is not running. Install it from https://ollama.com and make sure it's started."
                .to_string()
        })?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error: {}", text));
    }

    let mut full_response = String::new();
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        for line in chunk.split(|&b| b == b'\n') {
            if line.is_empty() {
                continue;
            }
            if let Ok(obj) = serde_json::from_slice::<serde_json::Value>(line) {
                if let Some(content) = obj["message"]["content"].as_str() {
                    if !content.is_empty() {
                        full_response.push_str(content);
                        let _ = tauri::Emitter::emit(
                            app,
                            "structuring-chunk",
                            content,
                        );
                    }
                }
            }
        }
    }

    Ok(full_response)
}

async fn resolve_and_call_ollama(
    app: &tauri::AppHandle,
    preferences: &[&str],
    family_name: &str,
    transcript: &str,
) -> Result<String, String> {
    let installed = list_ollama_models().await?;
    let model = pick_model(&installed, preferences).ok_or_else(|| {
        format!(
            "No {} model found in Ollama. Pull one first:\n  ollama pull {}",
            family_name,
            preferences[0]
        )
    })?;
    call_ollama_streaming(app, &model, transcript).await
}

async fn call_local(app: &tauri::AppHandle, transcript: &str) -> Result<String, String> {
    resolve_and_call_ollama(app, PHI_MODELS, "Phi", transcript).await
}

async fn call_gemma4_local(app: &tauri::AppHandle, transcript: &str) -> Result<String, String> {
    resolve_and_call_ollama(app, GEMMA_MODELS, "Gemma", transcript).await
}
