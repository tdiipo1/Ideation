use crate::audio::{self, SharedAudioBuffer};
use crate::healing;
use crate::history;
use crate::model_manager;
use crate::settings::{self, AppSettings};
use crate::state::{AppState, RecordingState, WorkerOutcome};
use crate::text::{is_hallucination, join_with_dedup, tail_chars};
use crate::transcribe;
use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Clone, serde::Serialize)]
pub struct TranscriptResult {
    pub id: String,
    pub raw: String,
    pub healed: String,
    pub duration_secs: f32,
    pub timestamp: String,
}

/// Emitted as `transcribe-error` whenever a recording can't be turned into a
/// transcript. `code` is stable for the UI (mic, no-model, audio, transcribe,
/// history, internal); `message` is the human-readable detail.
#[derive(Clone, serde::Serialize)]
pub struct TranscribeError {
    pub code: String,
    pub message: String,
}

fn terr(code: &str, message: impl Into<String>) -> TranscribeError {
    TranscribeError {
        code: code.to_string(),
        message: message.into(),
    }
}

#[tauri::command]
pub fn get_recording_state(state: State<'_, Arc<AppState>>) -> String {
    let s = state.recording_state.lock();
    match *s {
        RecordingState::Idle => "idle".to_string(),
        RecordingState::Recording => "recording".to_string(),
        RecordingState::Processing => "processing".to_string(),
    }
}

#[tauri::command]
pub fn get_last_transcript(state: State<'_, Arc<AppState>>) -> String {
    state.last_transcript.lock().clone()
}

fn show_indicator(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("indicator") {
        let _ = win.show();
        return;
    }

    let _ = WebviewWindowBuilder::new(app, "indicator", WebviewUrl::App("indicator.html".into()))
        .title("")
        .inner_size(80.0, 28.0)
        .position(
            app.primary_monitor()
                .ok()
                .flatten()
                .map(|m| m.size().width as f64 / m.scale_factor() - 100.0)
                .unwrap_or(1820.0),
            8.0,
        )
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .build();
}

fn hide_indicator(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("indicator") {
        let _ = win.close();
    }
}

fn play_sound(sound_type: &str) {
    std::thread::spawn({
        let sound_type = sound_type.to_string();
        move || {
            let (_stream, stream_handle) = match rodio::OutputStream::try_default() {
                Ok(s) => s,
                Err(_) => return,
            };
            // Generate a simple beep tone
            let sample_rate = 44100u32;
            let duration_ms = if sound_type == "start" { 100 } else { 200 };
            let freq = if sound_type == "start" { 880.0 } else { 440.0 };
            let num_samples = sample_rate * duration_ms / 1000;

            let samples: Vec<f32> = (0..num_samples)
                .map(|i| {
                    let t = i as f32 / sample_rate as f32;
                    let envelope = if i < num_samples / 10 {
                        i as f32 / (num_samples as f32 / 10.0)
                    } else if i > num_samples * 9 / 10 {
                        (num_samples - i) as f32 / (num_samples as f32 / 10.0)
                    } else {
                        1.0
                    };
                    (t * freq * 2.0 * std::f32::consts::PI).sin() * 0.3 * envelope
                })
                .collect();

            let source = rodio::buffer::SamplesBuffer::new(1, sample_rate, samples);
            let _ = stream_handle.play_raw(rodio::Source::convert_samples(source));
            std::thread::sleep(std::time::Duration::from_millis(duration_ms as u64 + 50));
        }
    });
}

/// Background streaming-transcription worker. While recording, it repeatedly
/// looks at the un-committed tail of the captured audio, cuts a segment at a
/// natural pause (VAD), transcribes it, and emits the growing transcript as
/// `transcript-partial` events so the UI can show live captions. Exactly one
/// of these runs at a time (whisper-rs is not safe for concurrent `full()`),
/// and stop_recording joins it before transcribing the final tail.
/// `transcribe-status` payload: whether inference is running right now and
/// how many seconds of captured audio are still waiting for it.
fn emit_status(app: &AppHandle, transcribing: bool, backlog_secs: f32) {
    let _ = app.emit(
        "transcribe-status",
        serde_json::json!({
            "transcribing": transcribing,
            "backlog_secs": backlog_secs.max(0.0),
            "phase": if transcribing { "transcribing" } else { "idle" },
        }),
    );
}

/// `transcribe-status` with a named phase (e.g. "polishing" during smart correction).
fn emit_phase(app: &AppHandle, phase: &str) {
    let _ = app.emit(
        "transcribe-status",
        serde_json::json!({
            "transcribing": phase != "idle",
            "backlog_secs": 0.0,
            "phase": phase,
        }),
    );
}

/// Emit the mic level (RMS of the last ~100 ms) every 50 ms while recording,
/// on its own thread so the meter keeps moving while the streaming worker is
/// busy inside whisper.
fn spawn_level_meter(app: AppHandle, audio_buf: Arc<SharedAudioBuffer>) {
    std::thread::spawn(move || {
        while *audio_buf.is_recording.lock() {
            let rms = {
                let samples = audio_buf.samples.lock();
                let n = samples.len();
                let win = (audio::SAMPLE_RATE as usize / 10).max(1);
                if n == 0 {
                    0.0
                } else {
                    let s = &samples[n.saturating_sub(win)..];
                    (s.iter().map(|x| x * x).sum::<f32>() / s.len().max(1) as f32).sqrt()
                }
            };
            let _ = app.emit("audio-level", rms);
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}

fn spawn_streaming_worker(
    app: AppHandle,
    audio_buf: Arc<SharedAudioBuffer>,
    model_path: PathBuf,
    language_setting: String,
    use_gpu: bool,
) -> JoinHandle<WorkerOutcome> {
    std::thread::spawn(move || {
        let mut outcome = WorkerOutcome::default();

        // No model on disk — let stop_recording report it.
        if !model_path.exists() {
            return outcome;
        }
        let mut session = match transcribe::Session::new(&model_path, &language_setting, use_gpu)
        {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Failed to start transcription session: {}", e);
                return outcome;
            }
        };
        if !session.is_multilingual() && language_setting != "auto" && language_setting != "en" {
            let _ = app.emit("notice", serde_json::json!({ "code": "needs-multilingual" }));
        }
        let mut vad = audio::Vad::load(&model_manager::vad_model_path());

        let sr = audio::SAMPLE_RATE as usize;
        let mut cursor: usize = 0;
        let mut accumulated = String::new();
        let mut prev_forced = false;
        let mut announced: Option<String> = None;
        // Language of the last decoded segment, for recordings too short to lock.
        let mut last_language: Option<String> = None;
        let mut last_status = std::time::Instant::now();
        // Raised when inference runs slower than real time: longer segments
        // mean fewer full-window encoder passes per second of speech.
        let mut min_segment_secs = audio::DEFAULT_MIN_SEGMENT_SECS;
        // Speech regions of the un-committed region. The VAD is re-run only
        // after >= 0.5 s of new audio (or a cut); it costs real CPU on 20 s.
        let mut regions: Vec<(usize, usize)> = Vec::new();
        let mut analyzed_len = 0usize;

        loop {
            let recording = *audio_buf.is_recording.lock();

            // Clone only the un-committed region (bounded by the VAD hard cap).
            let mut region = {
                let samples = audio_buf.samples.lock();
                if cursor < samples.len() {
                    samples[cursor..].to_vec()
                } else {
                    Vec::new()
                }
            };
            audio::normalize_gain(&mut region);

            // Tell the UI how far behind real time we are (throttled while idle).
            let backlog_secs = region.len() as f32 / sr as f32;
            if last_status.elapsed() >= std::time::Duration::from_millis(250) {
                emit_status(&app, false, backlog_secs);
                last_status = std::time::Instant::now();
            }

            if region.len() >= analyzed_len + sr / 2 {
                regions = vad.speech_regions(&region);
                analyzed_len = region.len();
            }

            if let Some(cut) = audio::cut_from_regions(region.len(), &regions, min_segment_secs) {
                let segment = &region[..cut.index];
                let seg_regions = audio::clip_regions(&regions, cut.index);
                if !seg_regions.is_empty() {
                    let ratio = audio::speech_fraction(segment.len(), &seg_regions);
                    let voiced_secs = audio::speech_secs(&seg_regions);
                    // Context for the decoder: what was said just before.
                    // Skipped on mostly-silent clips (Whisper echoes prompts
                    // over silence).
                    let prompt = if ratio >= 0.25 && !accumulated.is_empty() {
                        Some(tail_chars(&accumulated, 200))
                    } else {
                        None
                    };
                    emit_status(&app, true, backlog_secs);
                    let started = std::time::Instant::now();
                    match session.transcribe(segment, voiced_secs, prompt.as_deref()) {
                        Ok(out) => {
                            if !is_hallucination(&out.text, ratio) {
                                accumulated = join_with_dedup(&accumulated, &out.text, prev_forced);
                                let _ = app.emit("transcript-partial", accumulated.clone());
                            }
                            if out.language.is_some() {
                                last_language = out.language;
                            }
                            announce_language(&app, &session, &mut announced);
                        }
                        Err(e) => eprintln!("Streaming transcription failed: {}", e),
                    }
                    let inference_secs = started.elapsed().as_secs_f32();
                    min_segment_secs = (inference_secs * 1.5)
                        .clamp(audio::DEFAULT_MIN_SEGMENT_SECS, audio::MAX_MIN_SEGMENT_SECS);
                    let remaining = backlog_secs - cut.index as f32 / sr as f32;
                    emit_status(&app, false, remaining);
                    last_status = std::time::Instant::now();
                }
                // On a forced cut, back the cursor up ~0.75s so the next
                // segment re-hears the split word; join_with_dedup removes
                // the repeated words at the seam.
                let overlap = sr * 3 / 4;
                cursor += if cut.forced {
                    cut.index.saturating_sub(overlap).max(1)
                } else {
                    cut.index
                };
                prev_forced = cut.forced;
                regions.clear();
                analyzed_len = 0;
                // Loop again immediately to drain any backlog before sleeping.
                continue;
            }

            if !recording {
                // The capture thread may have died (no input device, unsupported
                // format, stream error). Nobody will call stop_recording for us
                // in that case, so reset the app state here instead of leaving
                // the UI stuck in "Recording".
                if let Some(err) = audio_buf.last_error.lock().clone() {
                    let st = app.state::<Arc<AppState>>();
                    let was_recording = {
                        let s = st.recording_state.lock();
                        *s == RecordingState::Recording
                    };
                    if was_recording {
                        *st.recording_state.lock() = RecordingState::Idle;
                        let _ = app.emit("recording-state-changed", "idle");
                        let _ = app.emit("transcribe-error", terr("mic", err));
                        hide_indicator(&app);
                    }
                }
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        outcome.text = accumulated;
        outcome.cursor = cursor;
        outcome.prev_forced = prev_forced;
        outcome.language = session
            .locked_language()
            .map(|s| s.to_string())
            .or(last_language);
        outcome.session = Some(session);
        outcome.vad = Some(vad);
        outcome
    })
}

/// Emit `language-detected` the first time the session commits to a language.
fn announce_language(
    app: &AppHandle,
    session: &transcribe::Session,
    announced: &mut Option<String>,
) {
    if let Some(code) = session.locked_language() {
        if announced.as_deref() != Some(code) {
            *announced = Some(code.to_string());
            let name = whisper_rs::get_lang_id(code)
                .and_then(whisper_rs::get_lang_str_full)
                .unwrap_or(code);
            let _ = app.emit(
                "language-detected",
                serde_json::json!({ "code": code, "name": name }),
            );
        }
    }
}

fn auto_paste_clipboard() {
    std::thread::spawn(|| {
        // Small delay to ensure clipboard is written
        std::thread::sleep(std::time::Duration::from_millis(150));
        // Cmd+V on macOS, Ctrl+V everywhere else.
        #[cfg(target_os = "macos")]
        let modifier = Key::Meta;
        #[cfg(not(target_os = "macos"))]
        let modifier = Key::Control;
        if let Ok(mut enigo) = Enigo::new(&EnigoSettings::default()) {
            let _ = enigo.key(modifier, Direction::Press);
            let _ = enigo.key(Key::Unicode('v'), Direction::Click);
            let _ = enigo.key(modifier, Direction::Release);
        }
    });
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    audio_buf: State<'_, Arc<SharedAudioBuffer>>,
) -> Result<(), String> {
    {
        let mut rec_state = state.recording_state.lock();
        if *rec_state != RecordingState::Idle {
            return Err("Already recording".to_string());
        }
        // Claim the state before the beep so a second toggle can't race us.
        *rec_state = RecordingState::Recording;
    }
    let _ = app.emit("recording-state-changed", "recording");

    let s = settings::load();
    if s.sound_feedback {
        // Play the beep and let it finish before the mic opens, so the tone is
        // never part of the recording (it used to leak into the first segment).
        play_sound("start");
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }

    if let Err(e) = crate::audio::start_recording(&audio_buf) {
        *state.recording_state.lock() = RecordingState::Idle;
        let _ = app.emit("recording-state-changed", "idle");
        let _ = app.emit("transcribe-error", terr("mic", e.clone()));
        return Err(e);
    }
    show_indicator(&app);
    spawn_level_meter(app.clone(), Arc::clone(&audio_buf));

    // Spawn the streaming worker so transcription happens progressively while
    // the user is still speaking (live captions + near-instant finalize).
    let model_path = model_manager::model_path(&s.whisper_model);
    let worker = spawn_streaming_worker(
        app.clone(),
        Arc::clone(&audio_buf),
        model_path,
        s.language.clone(),
        s.use_gpu,
    );
    *state.streaming_worker.lock() = Some(worker);

    Ok(())
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    audio_buf: State<'_, Arc<SharedAudioBuffer>>,
) -> Result<TranscriptResult, String> {
    {
        let mut rec_state = state.recording_state.lock();
        if *rec_state != RecordingState::Recording {
            return Err("Not recording".to_string());
        }
        *rec_state = RecordingState::Processing;
    }
    let _ = app.emit("recording-state-changed", "processing");
    hide_indicator(&app);

    let s = settings::load();
    let outcome = finish_recording(&app, &state, &audio_buf, &s).await;

    // Always return to Idle, whatever happened above. A failure in the tail
    // used to leave the app stuck in Processing with the toggle refusing
    // forever.
    *state.recording_state.lock() = RecordingState::Idle;
    let _ = app.emit("recording-state-changed", "idle");

    match outcome {
        Ok(Some(result)) => {
            *state.last_transcript.lock() = result.healed.clone();
            let _ = app.emit("transcript-ready", &result);

            // Auto-copy to clipboard — write directly from the backend so it
            // works regardless of whether the main webview is focused/visible
            // (this is a tray app driven by a global shortcut). Must happen
            // before auto-paste.
            if s.auto_copy {
                match app.clipboard().write_text(result.healed.clone()) {
                    Ok(()) => {
                        let _ = app.emit("auto-copied", ());
                    }
                    Err(e) => eprintln!("Auto-copy to clipboard failed: {}", e),
                }
            }
            if s.auto_paste {
                auto_paste_clipboard();
            }
            Ok(result)
        }
        Ok(None) => {
            // Nothing intelligible — don't clobber the clipboard, auto-paste,
            // or pollute history with an empty entry.
            let _ = app.emit("no-speech", ());
            Err("No speech detected".to_string())
        }
        Err(e) => {
            eprintln!("Transcription failed ({}): {}", e.code, e.message);
            let _ = app.emit("transcribe-error", &e);
            Err(e.message)
        }
    }
}

/// Everything between "stop" and "transcript ready": stop capture, join the
/// streaming worker, transcribe the remaining tail, heal, and save. Returns
/// `Ok(None)` when no speech was found. The caller owns the state machine.
async fn finish_recording(
    app: &AppHandle,
    state: &AppState,
    audio_buf: &Arc<SharedAudioBuffer>,
    s: &AppSettings,
) -> Result<Option<TranscriptResult>, TranscribeError> {
    // Stop capture first so the stop beep can never end up in the audio
    // (the capture thread polls this flag every 50 ms).
    *audio_buf.is_recording.lock() = false;
    if s.sound_feedback {
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        play_sound("stop");
    }

    // Join the streaming worker (off the async runtime) to get the transcript
    // it built during recording plus how far it got (raw-sample cursor).
    let handle = state.streaming_worker.lock().take();
    let outcome = if let Some(h) = handle {
        tokio::task::spawn_blocking(move || h.join().unwrap_or_default())
            .await
            .map_err(|e| terr("internal", format!("Worker join error: {}", e)))?
    } else {
        WorkerOutcome::default()
    };
    let WorkerOutcome {
        text: accumulated,
        cursor,
        prev_forced,
        session,
        vad,
        language: worker_language,
    } = outcome;

    if let Some(err) = audio_buf.last_error.lock().clone() {
        return Err(terr("mic", err));
    }

    // Let the cpal thread flush its final buffer, then drain the tail.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let (mut tail_audio, duration_secs) =
        audio::take_tail(audio_buf, cursor).map_err(|e| terr("audio", e))?;

    let model_path = model_manager::model_path(&s.whisper_model);
    if !model_path.exists() {
        return Err(terr(
            "no-model",
            "Whisper model not downloaded. Open Settings to download it.",
        ));
    }

    // Transcribe the remaining tail (reusing the worker's session so the
    // locked language carries over). A long tail means inference fell behind
    // real time; it is split into ≤28 s pieces at quiet frames and shown
    // progressively with a "N s left" countdown.
    audio::normalize_gain(&mut tail_audio);
    let tail_secs = tail_audio.len() as f32 / audio::SAMPLE_RATE as f32;
    emit_status(app, tail_secs > 0.0, tail_secs);
    let language_setting = s.language.clone();
    let use_gpu = s.use_gpu;
    let app2 = app.clone();
    let committed = accumulated.clone();
    let (tail_text, language) = tokio::task::spawn_blocking(
        move || -> Result<(String, Option<String>), String> {
            let mut session = match session {
                Some(sess) => sess,
                None => transcribe::Session::new(&model_path, &language_setting, use_gpu)?,
            };
            let mut vad = vad.unwrap_or_else(|| audio::Vad::load(&model_manager::vad_model_path()));
            let mut text = String::new();
            let pieces = audio::split_for_whisper(&tail_audio, audio::SAMPLE_RATE);
            let total = tail_audio.len() as f32;
            for (i, (start, end)) in pieces.iter().enumerate() {
                let piece = &tail_audio[*start..*end];
                let regions = vad.speech_regions(piece);
                if regions.is_empty() {
                    continue;
                }
                let ratio = audio::speech_fraction(piece.len(), &regions);
                let voiced_secs = audio::speech_secs(&regions);
                let context = join_with_dedup(&committed, &text, false);
                let prompt = if ratio >= 0.25 && !context.is_empty() {
                    Some(tail_chars(&context, 200))
                } else {
                    None
                };
                let out = session.transcribe(piece, voiced_secs, prompt.as_deref())?;
                if !is_hallucination(&out.text, ratio) {
                    text = join_with_dedup(&text, &out.text, false);
                }
                if i + 1 < pieces.len() {
                    let shown = join_with_dedup(&committed, &text, false);
                    let _ = app2.emit("transcript-partial", shown);
                    emit_status(&app2, true, (total - *end as f32) / audio::SAMPLE_RATE as f32);
                }
            }
            let language = session
                .locked_language()
                .map(|l| l.to_string())
                .or(worker_language);
            Ok((text, language))
        },
    )
    .await
    .map_err(|e| terr("internal", format!("Task join error: {}", e)))?
    .map_err(|e| terr("transcribe", e))?;
    emit_status(app, false, 0.0);

    let raw_transcript = join_with_dedup(&accumulated, &tail_text, prev_forced);
    if raw_transcript.trim().is_empty() {
        return Ok(None);
    }

    let mut healed_transcript = if s.healing_enabled {
        healing::heal_transcript(&raw_transcript, language.as_deref())
    } else {
        raw_transcript.clone()
    };

    // Optional local-LLM pass: fix misheard words from sentence context.
    // Bounded, and any failure just keeps the rule-healed text.
    if s.smart_correction {
        emit_phase(app, "polishing");
        let language_name = language
            .as_deref()
            .and_then(whisper_rs::get_lang_id)
            .and_then(whisper_rs::get_lang_str_full);
        match tokio::time::timeout(
            std::time::Duration::from_secs(20),
            crate::structuring::correct_transcript(&healed_transcript, language_name),
        )
        .await
        {
            Ok(Ok(Some(fixed))) => healed_transcript = fixed,
            Ok(Ok(None)) => {}
            Ok(Err(e)) => {
                eprintln!("Smart correction skipped: {}", e);
                let _ = app.emit(
                    "notice",
                    serde_json::json!({ "code": "smart-correction-skipped", "detail": e }),
                );
            }
            Err(_) => eprintln!("Smart correction timed out"),
        }
        emit_phase(app, "idle");
    }

    let entry = history::add_entry(duration_secs, &raw_transcript, &healed_transcript)
        .map_err(|e| terr("history", e))?;

    Ok(Some(TranscriptResult {
        id: entry.id,
        raw: raw_transcript,
        healed: healed_transcript,
        duration_secs,
        timestamp: entry.timestamp,
    }))
}

#[tauri::command]
pub async fn toggle_recording(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    audio_buf: State<'_, Arc<SharedAudioBuffer>>,
) -> Result<String, String> {
    let current_state = state.recording_state.lock().clone();
    match current_state {
        RecordingState::Idle => {
            start_recording(app, state, audio_buf).await?;
            Ok("recording".to_string())
        }
        RecordingState::Recording => {
            let _ = stop_recording(app, state, audio_buf).await?;
            Ok("idle".to_string())
        }
        RecordingState::Processing => Err("Currently processing, please wait".to_string()),
    }
}

// Settings commands

#[tauri::command]
pub fn get_settings() -> AppSettings {
    settings::load()
}

#[tauri::command]
pub fn save_settings(new_settings: AppSettings) -> Result<(), String> {
    settings::save(&new_settings)
}

// Prompt structuring

#[tauri::command]
pub async fn structure_as_prompt(app: AppHandle, transcript: String) -> Result<String, String> {
    let s = settings::load();

    // Local models don't need an API key
    if s.llm_provider != "local" && s.llm_provider != "gemma4" && s.llm_api_key.is_empty() {
        return Err("No API key configured. Go to Settings to add one.".to_string());
    }

    let config = crate::structuring::LlmConfig {
        provider: s.llm_provider,
        api_key: s.llm_api_key,
        model: if s.llm_model.is_empty() {
            None
        } else {
            Some(s.llm_model)
        },
    };

    crate::structuring::structure_prompt(&app, &config, &transcript).await
}

// Model management commands

#[tauri::command]
pub fn get_available_models() -> Vec<model_manager::ModelInfo> {
    model_manager::available_models()
}

#[tauri::command]
pub fn is_model_downloaded(filename: String) -> bool {
    model_manager::is_model_downloaded(&filename)
}

#[tauri::command]
pub async fn download_model(app: AppHandle, model_name: String) -> Result<String, String> {
    let models = model_manager::available_models();
    let model = models
        .iter()
        .find(|m| m.name == model_name)
        .ok_or_else(|| format!("Unknown model: {}", model_name))?;

    let path = model_manager::download_model(&app, model).await?;
    Ok(path.to_string_lossy().to_string())
}

/// Eagerly load a model into the cached WhisperContext so the next
/// transcription doesn't pay the disk-read cost on first use.
/// For large models (e.g. distil-large-v3.5 at 1.5 GB) this can take
/// 5-10 seconds, so it runs on a blocking thread to avoid stalling the UI.
#[tauri::command]
pub async fn preload_model(app: AppHandle, filename: String) -> Result<(), String> {
    let path = model_manager::model_path(&filename);
    let use_gpu = settings::load().use_gpu;
    let _ = app.emit(
        "model-status",
        transcribe::ModelStatus {
            state: "loading",
            model: filename.clone(),
            gpu: false,
            message: None,
        },
    );
    let result = tokio::task::spawn_blocking(move || transcribe::preload(&path, use_gpu))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    let _ = app.emit("model-status", transcribe::model_status());
    result
}

/// Warm the model cache off the main thread at startup, reporting progress
/// as `model-status` events.
pub fn preload_in_background(app: AppHandle) {
    std::thread::spawn(move || {
        let s = settings::load();
        let path = model_manager::model_path(&s.whisper_model);
        let _ = app.emit(
            "model-status",
            transcribe::ModelStatus {
                state: "loading",
                model: s.whisper_model.clone(),
                gpu: false,
                message: None,
            },
        );
        if let Err(e) = transcribe::preload(&path, s.use_gpu) {
            eprintln!("Model preload failed: {}", e);
        }
        let _ = app.emit("model-status", transcribe::model_status());
    });
}

#[tauri::command]
pub fn get_model_status() -> transcribe::ModelStatus {
    transcribe::model_status()
}

#[derive(Clone, serde::Serialize)]
pub struct BuildInfo {
    /// "vulkan" | "metal" | "none"
    pub gpu_backend: &'static str,
    pub version: &'static str,
}

#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    BuildInfo {
        gpu_backend: transcribe::GPU_BACKEND,
        version: env!("CARGO_PKG_VERSION"),
    }
}

// History commands

#[tauri::command]
pub fn get_history(limit: Option<usize>, offset: Option<usize>) -> Vec<history::TranscriptEntry> {
    history::get_entries(limit.unwrap_or(50), offset.unwrap_or(0))
}

#[tauri::command]
pub fn delete_history_entry(id: String) -> Result<(), String> {
    history::delete_entry(&id)
}

#[tauri::command]
pub fn clear_history() -> Result<(), String> {
    history::clear_history()
}
