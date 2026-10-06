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

/// Beam width for the small/base/tiny models. whisper-cli's default is 5;
/// greedy decoding (what this app used before) measurably loses accuracy on
/// exactly the "which of these similar words was it" cases. The large models
/// keep greedy: their decoder is where the time goes.
const BEAM_SIZE: i32 = 5;

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
    /// Large models decode greedily (their decoder dominates the time);
    /// everything else uses beam search.
    heavy: bool,
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
        let heavy = model_path
            .file_name()
            .map(|n| n.to_string_lossy().contains("large"))
            .unwrap_or(false);
        Ok(Self {
            ctx,
            state,
            setting,
            locked: None,
            heavy,
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

    /// Transcribe a 16 kHz mono clip.
    /// - `voiced_secs`: how much of the clip the VAD considered speech; gates
    ///   the auto-detect lock.
    /// - `prompt`: text already transcribed before this clip. Whisper
    ///   conditions on it, which keeps names, casing and punctuation
    ///   consistent across streaming segments and helps disambiguate words
    ///   at the start of a clip. Pass `None` for mostly-silent clips: Whisper
    ///   tends to echo the prompt over silence.
    pub fn transcribe(
        &mut self,
        audio: &[f32],
        voiced_secs: f32,
        prompt: Option<&str>,
    ) -> Result<TranscribeOutput, String> {
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

        let strategy = if self.heavy {
            SamplingStrategy::Greedy { best_of: 5 }
        } else {
            SamplingStrategy::BeamSearch {
                beam_size: BEAM_SIZE,
                patience: -1.0,
            }
        };
        let mut params = FullParams::new(strategy);
        params.set_language(Some(&lang));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_timestamps(true);
        params.set_suppress_blank(true);
        // Drop the non-speech tokens (♪, [laughs] …) at the decoder instead
        // of regex-ing them out afterwards.
        params.set_suppress_nst(true);
        // Temperature fallback (whisper.cpp defaults, stated explicitly):
        // retry at higher temperatures when the decode looks degenerate.
        params.set_temperature(0.0);
        params.set_temperature_inc(0.2);
        params.set_entropy_thold(2.4);
        params.set_logprob_thold(-1.0);
        params.set_no_speech_thold(0.6);
        params.set_n_threads(get_num_threads());
        if let Some(p) = prompt.map(str::trim).filter(|p| !p.is_empty()) {
            params.set_initial_prompt(p);
        }

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

#[cfg(test)]
mod bench {
    //! Manual benchmark: transcribe a WAV file with a given model and print
    //! the text, detected language and timing. Not run by default.
    //!
    //!   IDEATION_BENCH_WAV=test-audio/es-pauses.wav \
    //!   IDEATION_BENCH_MODEL=%LOCALAPPDATA%/com.ideation.desktop/models/ggml-base.bin \
    //!   IDEATION_BENCH_LANG=auto \
    //!   cargo test --release --lib bench -- --ignored --nocapture
    use super::*;

    fn read_wav_16k(path: &str) -> Vec<f32> {
        let mut reader = hound::WavReader::open(path).expect("open wav");
        let spec = reader.spec();
        let channels = spec.channels as usize;
        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap()).collect(),
            hound::SampleFormat::Int => {
                let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
                reader.samples::<i32>().map(|s| s.unwrap() as f32 / max).collect()
            }
        };
        let mono: Vec<f32> = samples
            .chunks(channels)
            .map(|f| f.iter().sum::<f32>() / f.len() as f32)
            .collect();
        crate::audio::resample(&mono, spec.sample_rate, 16000).expect("resample")
    }

    #[test]
    #[ignore]
    fn transcribe_wav() {
        let wav = std::env::var("IDEATION_BENCH_WAV").expect("IDEATION_BENCH_WAV");
        let model = std::env::var("IDEATION_BENCH_MODEL").expect("IDEATION_BENCH_MODEL");
        let lang = std::env::var("IDEATION_BENCH_LANG").unwrap_or_else(|_| "auto".into());
        let prompt = std::env::var("IDEATION_BENCH_PROMPT").ok();
        let audio = read_wav_16k(&wav);
        let secs = audio.len() as f32 / 16000.0;

        let t0 = std::time::Instant::now();
        let mut session = Session::new(Path::new(&model), &lang, true).expect("session");
        let load_ms = t0.elapsed().as_millis();

        let t1 = std::time::Instant::now();
        let out = session
            .transcribe(&audio, secs, prompt.as_deref())
            .expect("transcribe");
        let ms = t1.elapsed().as_millis();
        println!(
            "model={} gpu={} load={}ms audio={:.1}s decode={}ms ({:.2}x realtime) language={:?} threads={}",
            model,
            ACTIVE_GPU.load(Ordering::Relaxed),
            load_ms,
            secs,
            ms,
            ms as f32 / 1000.0 / secs,
            out.language,
            get_num_threads()
        );
        println!("TEXT: {}", out.text);
    }
}
