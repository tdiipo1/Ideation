use serde::{Deserialize, Serialize};

const SYSTEM_PROMPT: &str = "Restructure this spoken transcript into a clear, organized prompt for an AI assistant. Preserve all meaning and details. Use sections/headers for multiple topics, bullet points for lists. Fix grammar, remove filler words. Output only the structured prompt.";

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

pub async fn structure_prompt(config: &LlmConfig, transcript: &str) -> Result<String, String> {
    let client = reqwest::Client::new();

    match config.provider.as_str() {
        "local" => call_local(transcript).await,
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

fn phi_model_path() -> std::path::PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    base.join("com.ideation.desktop")
        .join("models")
        .join("Phi-4-mini-instruct-Q4_K_M.gguf")
}

pub fn is_local_model_downloaded() -> bool {
    phi_model_path().exists()
}

pub async fn download_local_model(
    app: &tauri::AppHandle,
) -> Result<std::path::PathBuf, String> {
    use futures_util::StreamExt;

    let path = phi_model_path();
    if path.exists() {
        return Ok(path);
    }

    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create dir: {}", e))?;

    let url = "https://huggingface.co/bartowski/Phi-4-mini-instruct-GGUF/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf";
    let temp_path = path.with_extension("downloading");

    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    let mut downloaded: u64 = 0;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            let _ = tauri::Emitter::emit(
                app,
                "phi-download-progress",
                serde_json::json!({ "progress": progress, "downloaded_mb": downloaded / 1_000_000, "total_mb": total_size / 1_000_000 }),
            );
        }
    }

    drop(file);
    std::fs::rename(&temp_path, &path).map_err(|e| format!("Rename error: {}", e))?;
    Ok(path)
}

async fn call_local(transcript: &str) -> Result<String, String> {
    let model_path = phi_model_path();
    if !model_path.exists() {
        return Err(
            "Phi-4-mini model not downloaded. Go to Settings and download it first.".to_string(),
        );
    }

    // Call llama-server via OpenAI-compatible API (localhost:8080)
    // User must start llama-server separately:
    //   llama-server -m Phi-4-mini-instruct-Q4_K_M.gguf -c 2048
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "phi-4-mini",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": transcript}
        ],
        "temperature": 0.3,
        "max_tokens": 1024
    });

    let resp = client
        .post("http://127.0.0.1:8080/v1/chat/completions")
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            "Could not connect to local LLM server. Start llama-server first:\n\n\
             llama-server -m Phi-4-mini-instruct-Q4_K_M.gguf -c 2048\n\n\
             Download llama-server from https://github.com/ggerganov/llama.cpp/releases"
                .to_string()
        })?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Local LLM error: {}", text));
    }

    let data: OpenAiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    data.choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "No response from local LLM".to_string())
}
