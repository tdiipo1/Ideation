use std::path::{Path, PathBuf};
use std::sync::Mutex;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

// Cache the Whisper context to avoid reloading the model on every transcription.
// The lock is held for the entire transcription to prevent race conditions.
static CACHED_CTX: Mutex<Option<(PathBuf, WhisperContext)>> = Mutex::new(None);

// Cache thread count once
static NUM_THREADS: std::sync::OnceLock<i32> = std::sync::OnceLock::new();

fn get_num_threads() -> i32 {
    *NUM_THREADS.get_or_init(|| {
        let cores = std::thread::available_parallelism()
            .map(|n| n.get() as i32)
            .unwrap_or(4);
        // Use up to 8 threads — diminishing returns beyond that for Whisper
        cores.min(8)
    })
}

// English-only models have ".en" in the filename. Multilingual models don't.
fn is_english_only(model_path: &Path) -> bool {
    model_path
        .file_name()
        .and_then(|s| s.to_str())
        .map(|name| name.contains(".en"))
        .unwrap_or(false)
}

fn ensure_loaded(model_path: &Path) -> Result<(), String> {
    let mut cache = CACHED_CTX.lock().map_err(|e| format!("Lock error: {}", e))?;
    let need_load = match cache.as_ref() {
        Some((cached_path, _)) => cached_path != model_path,
        None => true,
    };
    if need_load {
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().ok_or("Invalid model path")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("Failed to load Whisper model: {}", e))?;
        *cache = Some((model_path.to_path_buf(), ctx));
    }
    Ok(())
}

/// Load the model into the cached WhisperContext without running inference.
/// Used to eagerly warm the cache after a model download/swap so the first
/// transcription doesn't pay the disk-read cost (which can be 10+ seconds
/// for the 1.5 GB distil-large-v3.5 file).
pub fn preload(model_path: &Path) -> Result<(), String> {
    ensure_loaded(model_path)
}

pub fn transcribe(model_path: &Path, audio: &[f32]) -> Result<String, String> {
    ensure_loaded(model_path)?;

    let cache = CACHED_CTX.lock().map_err(|e| format!("Lock error: {}", e))?;
    let (_, ctx) = cache.as_ref().unwrap();

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create state: {}", e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

    // Multilingual models auto-detect language; English-only models lock to "en".
    if is_english_only(model_path) {
        params.set_language(Some("en"));
    }
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_timestamps(true);
    params.set_suppress_blank(true);
    params.set_n_threads(get_num_threads());

    state
        .full(params, audio)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    let num_segments = state.full_n_segments();
    let mut text = String::new();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            if let Ok(s) = segment.to_str_lossy() {
                text.push_str(&s);
            }
        }
    }

    Ok(text.trim().to_string())
}
