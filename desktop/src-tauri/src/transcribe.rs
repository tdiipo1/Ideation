//! Whisper inference. The loaded model (`WhisperContext`) is cached process-
//! wide; each recording gets a `Session` that owns one `WhisperState` and the
//! language policy for that recording (pinned code, or detect-once-then-lock).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

// Cache the Whisper context so the model is not reloaded on every recording.
// The lock is held only while cloning the Arc out (or loading a new model).
static CACHED_CTX: Mutex<Option<(PathBuf, Arc<WhisperContext>)>> = Mutex::new(None);

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

/// Voiced seconds a segment needs before an auto-detected language is locked
/// for the rest of the recording. Shorter clips still get transcribed with
/// whatever was detected, but don't commit the session to it.
pub const LOCK_MIN_VOICED_SECS: f32 = 2.0;

fn get_ctx(model_path: &Path) -> Result<Arc<WhisperContext>, String> {
    let mut cache = CACHED_CTX.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some((cached_path, ctx)) = cache.as_ref() {
        if cached_path == model_path {
            return Ok(Arc::clone(ctx));
        }
    }
    let ctx = WhisperContext::new_with_params(
        model_path.to_str().ok_or("Invalid model path")?,
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load Whisper model: {}", e))?;
    let ctx = Arc::new(ctx);
    *cache = Some((model_path.to_path_buf(), Arc::clone(&ctx)));
    Ok(ctx)
}

/// Load the model into the cache without running inference. Used to warm the
/// cache at startup and after a model download/swap so the first
/// transcription doesn't pay the disk-read cost (10+ seconds for the 1.5 GB
/// distil-large-v3.5 file).
pub fn preload(model_path: &Path) -> Result<(), String> {
    get_ctx(model_path).map(|_| ())
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
    pub fn new(model_path: &Path, language_setting: &str) -> Result<Self, String> {
        let ctx = get_ctx(model_path)?;
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
