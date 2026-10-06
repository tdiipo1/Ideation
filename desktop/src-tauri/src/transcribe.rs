//! Whisper inference. The loaded model (`WhisperContext`) is cached process-
//! wide; each recording gets a `Session` that owns one `WhisperState` and the
//! language policy for that recording (pinned code, or detect-once-then-lock).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

/// GPU backend compiled into this binary (cargo features `gpu-vulkan` /
/// `gpu-metal`). The default build is CPU-only.
pub const GPU_BACKEND: &str = if cfg!(feature = "gpu-vulkan") {
    "vulkan"
} else if cfg!(feature = "gpu-metal") {
    "metal"
} else {
    "none"
};

pub fn gpu_available() -> bool {
    GPU_BACKEND != "none"
}

struct CachedCtx {
    path: PathBuf,
    /// The GPU flag the context was *requested* with (so a failed GPU load
    /// that fell back to CPU isn't retried on every call).
    gpu: bool,
    ctx: Arc<WhisperContext>,
}

// Cache the Whisper context so the model is not reloaded on every recording.
// The lock is held only while cloning the Arc out (or loading a new model).
static CACHED_CTX: Mutex<Option<CachedCtx>> = Mutex::new(None);

/// Whether the cached model actually runs on the GPU.
static ACTIVE_GPU: AtomicBool = AtomicBool::new(false);

/// Load state reported to the UI (`model-status` event / `get_model_status`).
#[derive(Clone, serde::Serialize)]
pub struct ModelStatus {
    /// "idle" | "loading" | "ready" | "error" | "missing"
    pub state: &'static str,
    pub model: String,
    pub gpu: bool,
    pub message: Option<String>,
}

static MODEL_STATUS: Mutex<ModelStatus> = Mutex::new(ModelStatus {
    state: "idle",
    model: String::new(),
    gpu: false,
    message: None,
});

pub fn model_status() -> ModelStatus {
    match MODEL_STATUS.lock() {
        Ok(s) => s.clone(),
        Err(e) => e.into_inner().clone(),
    }
}

fn set_status(state: &'static str, model: &str, gpu: bool, message: Option<String>) {
    if let Ok(mut s) = MODEL_STATUS.lock() {
        *s = ModelStatus {
            state,
            model: model.to_string(),
            gpu,
            message,
        };
    }
}

// Cache thread count once
static NUM_THREADS: std::sync::OnceLock<i32> = std::sync::OnceLock::new();

fn get_num_threads() -> i32 {
    *NUM_THREADS.get_or_init(|| {
        let logical = std::thread::available_parallelism()
            .map(|n| n.get() as i32)
            .unwrap_or(4);
        // ggml gains little from hyperthreads (and can lose to them), so use
        // the physical-core estimate: half the logical count, 2..=8.
        (logical / 2).clamp(2, 8)
    })
}

/// Voiced seconds a segment needs before an auto-detected language is locked
/// for the rest of the recording. Shorter clips still get transcribed with
/// whatever was detected, but don't commit the session to it.
pub const LOCK_MIN_VOICED_SECS: f32 = 2.0;

fn load_ctx(model_path: &Path, gpu: bool) -> Result<WhisperContext, String> {
    let mut params = WhisperContextParameters::default();
    params.use_gpu(gpu);
    // Flash attention is what makes the GPU path fast; harmless on CPU.
    params.flash_attn(gpu);
    WhisperContext::new_with_params(
        model_path.to_str().ok_or("Invalid model path")?,
        params,
    )
    .map_err(|e| format!("Failed to load Whisper model: {}", e))
}

fn get_ctx(model_path: &Path, want_gpu: bool) -> Result<Arc<WhisperContext>, String> {
    let gpu = want_gpu && gpu_available();
    let mut cache = CACHED_CTX.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(c) = cache.as_ref() {
        if c.path == model_path && c.gpu == gpu {
            return Ok(Arc::clone(&c.ctx));
        }
    }
    let (ctx, used_gpu) = match load_ctx(model_path, gpu) {
        Ok(c) => (c, gpu),
        Err(e) if gpu => {
            eprintln!("GPU model load failed ({}); falling back to CPU", e);
            (load_ctx(model_path, false)?, false)
        }
        Err(e) => return Err(e),
    };
    let ctx = Arc::new(ctx);
    ACTIVE_GPU.store(used_gpu, Ordering::Relaxed);
    *cache = Some(CachedCtx {
        path: model_path.to_path_buf(),
        gpu,
        ctx: Arc::clone(&ctx),
    });
    Ok(ctx)
}

/// Load the model into the cache without running inference, updating the
/// model status as it goes. Used at startup and after a model download/swap
/// so the first transcription doesn't pay the disk-read cost (10+ seconds
/// for the 1.5 GB distil-large-v3.5 file).
pub fn preload(model_path: &Path, use_gpu: bool) -> Result<(), String> {
    let name = model_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if !model_path.exists() {
        set_status("missing", &name, false, None);
        return Err(format!("Model not downloaded: {}", name));
    }
    set_status("loading", &name, false, None);
    match get_ctx(model_path, use_gpu) {
        Ok(_) => {
            set_status("ready", &name, ACTIVE_GPU.load(Ordering::Relaxed), None);
            Ok(())
        }
        Err(e) => {
            set_status("error", &name, false, Some(e.clone()));
            Err(e)
        }
    }
}

pub struct TranscribeOutput {
    pub text: String,
    /// Language the call was decoded in (pinned, locked, or detected for
    /// this clip). `None` only when whisper.cpp reports an unknown id.
    pub language: Option<String>,
}

/// One recording's worth of inference: a reusable `WhisperState` plus the
/// language policy. Create it when recording starts, feed it every streaming
/// segment and finally the tail.
pub struct Session {
    ctx: Arc<WhisperContext>,
    state: WhisperState,
    /// The user's setting: "auto" or an ISO-639-1 code.
    setting: String,
    /// Language committed for the rest of the recording.
    locked: Option<String>,
    /// Text committed so far; used as the decoder prompt for context.
    #[allow(dead_code)] // wired up by the cross-segment context pass
    pub prev_text: String,
}

impl Session {
    pub fn new(model_path: &Path, language_setting: &str, use_gpu: bool) -> Result<Self, String> {
        let ctx = get_ctx(model_path, use_gpu)?;
        let state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create state: {}", e))?;
        let setting = if whisper_rs::get_lang_id(language_setting).is_some() {
            language_setting.to_string()
        } else {
            "auto".to_string()
        };
        Ok(Self {
            ctx,
            state,
            setting,
            locked: None,
            prev_text: String::new(),
        })
    }

    pub fn is_multilingual(&self) -> bool {
        self.ctx.is_multilingual()
    }

    /// The language this session is committed to, if any. English-only
    /// models are always "en".
    pub fn locked_language(&self) -> Option<&str> {
        if !self.ctx.is_multilingual() {
            return Some("en");
        }
        self.locked.as_deref()
    }

    /// Transcribe a 16 kHz mono clip. `voiced_secs` is how much of it the
    /// VAD considered speech; it gates the auto-detect lock.
    pub fn transcribe(&mut self, audio: &[f32], voiced_secs: f32) -> Result<TranscribeOutput, String> {
        // Decide the language for this call. whisper.cpp's default is "en",
        // so multilingual models must be told "auto" explicitly — and "auto"
        // costs an extra encoder pass, which is why we lock as soon as a
        // segment with enough speech has been detected.
        let multilingual = self.ctx.is_multilingual();
        let lang: String = match (&self.locked, self.setting.as_str(), multilingual) {
            (_, _, false) => "en".to_string(),
            (Some(l), _, true) => l.clone(),
            (None, "auto", true) => "auto".to_string(),
            (None, code, true) => code.to_string(),
        };

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 5 });
        params.set_language(Some(&lang));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_timestamps(true);
        params.set_suppress_blank(true);
        params.set_n_threads(get_num_threads());

        self.state
            .full(params, audio)
            .map_err(|e| format!("Transcription failed: {}", e))?;

        let num_segments = self.state.full_n_segments();
        let mut text = String::new();
        for i in 0..num_segments {
            if let Some(segment) = self.state.get_segment(i) {
                if let Ok(s) = segment.to_str_lossy() {
                    text.push_str(&s);
                }
            }
        }

        let detected = whisper_rs::get_lang_str(self.state.full_lang_id_from_state())
            .map(|s| s.to_string());
        if lang == "auto" && voiced_secs >= LOCK_MIN_VOICED_SECS {
            if let Some(code) = detected.as_ref() {
                self.locked = Some(code.clone());
            }
        }
        if !multilingual {
            return Ok(TranscribeOutput {
                text: text.trim().to_string(),
                language: Some("en".to_string()),
            });
        }

        Ok(TranscribeOutput {
            text: text.trim().to_string(),
            language: detected,
        })
    }
}
