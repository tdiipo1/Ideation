use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub filename: String,
    pub url: String,
    pub sha256: String,
    pub size_mb: u64,
}

pub fn available_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            name: "base.en".to_string(),
            filename: "ggml-base.en.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
                .to_string(),
            sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
                .to_string(),
            size_mb: 142,
        },
        ModelInfo {
            name: "small.en".to_string(),
            filename: "ggml-small.en.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
                .to_string(),
            sha256: "20e05c75a65869a1a587e075ed4eea98bad3b0e65f1eaa1b4e5e37eea43e64fe"
                .to_string(),
            size_mb: 466,
        },
    ]
}

pub fn models_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("com.ideation.desktop").join("models")
}

pub fn model_path(filename: &str) -> PathBuf {
    models_dir().join(filename)
}

pub fn is_model_downloaded(filename: &str) -> bool {
    model_path(filename).exists()
}

pub async fn download_model(app: &AppHandle, model: &ModelInfo) -> Result<PathBuf, String> {
    let dir = models_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models dir: {}", e))?;

    let path = dir.join(&model.filename);

    // If already exists, verify and return
    if path.exists() {
        return Ok(path);
    }

    let temp_path = dir.join(format!("{}.downloading", &model.filename));

    let client = reqwest::Client::new();
    let response = client
        .get(&model.url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut hasher = Sha256::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("Write error: {}", e))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        // Emit progress every ~1%
        if total_size > 0 {
            let progress = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            let _ = app.emit(
                "model-download-progress",
                serde_json::json!({
                    "model": model.name,
                    "progress": progress,
                    "downloaded_mb": downloaded / 1_000_000,
                    "total_mb": total_size / 1_000_000,
                }),
            );
        }
    }

    drop(file);

    // Verify hash
    let hash = hex::encode(hasher.finalize());
    if hash != model.sha256 {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "Hash mismatch: expected {}, got {}",
            model.sha256, hash
        ));
    }

    // Rename temp to final
    std::fs::rename(&temp_path, &path).map_err(|e| format!("Failed to rename model: {}", e))?;

    let _ = app.emit(
        "model-download-complete",
        serde_json::json!({ "model": model.name }),
    );

    Ok(path)
}
