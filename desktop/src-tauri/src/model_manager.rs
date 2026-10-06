use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub label: String,
    pub description: String,
    pub filename: String,
    pub url: String,
    pub sha256: String,
    pub size_mb: u64,
    /// English-only checkpoints can't transcribe other languages at all.
    pub english_only: bool,
}

pub fn available_models() -> Vec<ModelInfo> {
    // SHA256 hashes are pinned for integrity verification when published.
    // Empty sha256 means "skip verification" — used for upstream files that
    // don't publish a hash (distil-* repos and the turbo quantized files).
    vec![
        ModelInfo {
            name: "base.en".to_string(),
            english_only: true,
            label: "Base (English)".to_string(),
            description: "Default — fast and accurate".to_string(),
            filename: "ggml-base.en.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
                .to_string(),
            sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
                .to_string(),
            size_mb: 142,
        },
        ModelInfo {
            name: "small.en".to_string(),
            english_only: true,
            label: "Small (English)".to_string(),
            description: "Better accuracy, slower".to_string(),
            filename: "ggml-small.en.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
                .to_string(),
            sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d"
                .to_string(),
            size_mb: 466,
        },
        ModelInfo {
            name: "base".to_string(),
            english_only: false,
            label: "Base (Multilingual)".to_string(),
            description: "99 languages, slightly slower".to_string(),
            filename: "ggml-base.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
                .to_string(),
            sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"
                .to_string(),
            size_mb: 142,
        },
        ModelInfo {
            name: "small".to_string(),
            english_only: false,
            label: "Small (Multilingual)".to_string(),
            description: "Much better for Spanish, Chinese, Portuguese… Good middle ground.".to_string(),
            filename: "ggml-small.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
                .to_string(),
            sha256: "".to_string(),
            size_mb: 466,
        },
        ModelInfo {
            name: "large-v3-turbo".to_string(),
            english_only: false,
            label: "Large v3 Turbo (Multilingual)".to_string(),
            description: "Top quality, all languages. Best on fast machines.".to_string(),
            filename: "ggml-large-v3-turbo-q5_0.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"
                .to_string(),
            sha256: "".to_string(),
            size_mb: 574,
        },
        ModelInfo {
            name: "distil-large-v3.5".to_string(),
            english_only: true,
            label: "Distil Large v3.5 (English)".to_string(),
            description: "Highest quality English. Best on fast machines, short clips.".to_string(),
            filename: "ggml-distil-large-v3.5.bin".to_string(),
            url: "https://huggingface.co/distil-whisper/distil-large-v3.5-ggml/resolve/main/ggml-model.bin"
                .to_string(),
            sha256: "".to_string(),
            size_mb: 1520,
        },
    ]
}

pub const VAD_FILENAME: &str = "ggml-silero-v5.1.2.bin";

/// whisper.cpp's Silero VAD model (~1 MB), downloaded at startup. Not part of
/// `available_models()`: it isn't user-selectable.
pub fn vad_model() -> ModelInfo {
    ModelInfo {
        name: "silero-vad".to_string(),
        english_only: false,
        label: "Silero VAD".to_string(),
        description: "Voice activity detection".to_string(),
        filename: VAD_FILENAME.to_string(),
        url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin"
            .to_string(),
        sha256: "".to_string(),
        size_mb: 1,
    }
}

pub fn vad_model_path() -> PathBuf {
    model_path(VAD_FILENAME)
}

/// Download the VAD model if it isn't on disk yet. Failures are logged; the
/// app falls back to the energy detector until the next launch.
pub async fn ensure_vad_model(app: &AppHandle) {
    if vad_model_path().exists() {
        return;
    }
    if let Err(e) = download_model(app, &vad_model()).await {
        eprintln!("VAD model download failed: {}", e);
    }
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

/// On first launch, copy the bundled base.en model to the models directory
pub fn ensure_bundled_model(app: &AppHandle) {
    let dest = model_path("ggml-base.en.bin");
    if dest.exists() {
        return; // Already have it
    }

    // Create models directory
    let dir = models_dir();
    let _ = std::fs::create_dir_all(&dir);

    // Try to find the bundled resource
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("resources").join("ggml-base.en.bin");
        if bundled.exists() {
            let _ = std::fs::copy(&bundled, &dest);
        }
    }
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
    let mut last_emit = std::time::Instant::now();
    let mut last_progress: u32 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("Write error: {}", e))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        // Throttle progress events to ~200ms intervals
        if total_size > 0 && last_emit.elapsed() > std::time::Duration::from_millis(200) {
            let progress = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            if progress != last_progress {
                let _ = app.emit(
                    "model-download-progress",
                    serde_json::json!({
                        "model": model.name,
                        "progress": progress,
                        "downloaded_mb": downloaded / 1_000_000,
                        "total_mb": total_size / 1_000_000,
                    }),
                );
                last_progress = progress;
            }
            last_emit = std::time::Instant::now();
        }
    }

    drop(file);

    // Verify hash. Skip if upstream doesn't publish a SHA256 (empty string).
    if !model.sha256.is_empty() {
        let hash = hex::encode(hasher.finalize());
        if hash != model.sha256 {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "Hash mismatch: expected {}, got {}",
                model.sha256, hash
            ));
        }
    }

    // Rename temp to final
    std::fs::rename(&temp_path, &path).map_err(|e| format!("Failed to rename model: {}", e))?;

    let _ = app.emit(
        "model-download-complete",
        serde_json::json!({ "model": model.name }),
    );

    Ok(path)
}
