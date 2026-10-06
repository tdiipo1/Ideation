use crate::audio::SharedAudioBuffer;
use crate::healing;
use crate::history;
use crate::model_manager;
use crate::settings::{self, AppSettings};
use crate::state::{AppState, RecordingState};
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
fn spawn_streaming_worker(
    app: AppHandle,
    audio_buf: Arc<SharedAudioBuffer>,
    model_path: PathBuf,
) -> JoinHandle<(String, usize, bool)> {
    std::thread::spawn(move || {
        let mut cursor: usize = 0;
        let mut accumulated = String::new();
        let mut prev_forced = false;

        // No model on disk — let stop_recording produce the placeholder.
        if !model_path.exists() {
            return (accumulated, cursor, prev_forced);
        }

        loop {
            let recording = *audio_buf.is_recording.lock();
            let source_rate = *audio_buf.source_sample_rate.lock();

            // Emit a mic level (RMS of the last ~100ms) for the live meter.
            {
                let samples = audio_buf.samples.lock();
                let n = samples.len();
                let win = (source_rate as usize / 10).max(1);
                if recording && n > 0 {
                    let s = &samples[n.saturating_sub(win)..];
                    let rms =
                        (s.iter().map(|x| x * x).sum::<f32>() / s.len().max(1) as f32).sqrt();
                    let _ = app.emit("audio-level", rms);
                }
            }

            // Clone only the un-committed region (bounded by the VAD hard cap).
            let region = {
                let samples = audio_buf.samples.lock();
                if cursor < samples.len() {
                    samples[cursor..].to_vec()
                } else {
                    Vec::new()
                }
            };

            if let Some(cut) = crate::audio::find_cut_point(&region, source_rate) {
                let raw_segment = &region[..cut.index];
                if crate::audio::has_speech(raw_segment, source_rate) {
                    let ratio = crate::audio::speech_ratio(raw_segment, source_rate);
                    match crate::audio::resample_to_16k(raw_segment, source_rate) {
                        Ok(seg16k) => {
                            if let Ok(text) = transcribe::transcribe(&model_path, &seg16k) {
                                if !is_hallucination(&text, ratio) {
                                    accumulated =
                                        join_with_dedup(&accumulated, &text, prev_forced);
                                    let _ = app.emit("transcript-partial", accumulated.clone());
                                }
                            }
                        }
                        Err(e) => eprintln!("Streaming resample failed: {}", e),
                    }
                }
                // On a forced cut, back the cursor up ~0.75s so the next
                // segment re-hears the split word; join_with_dedup removes
                // the repeated words at the seam.
                let overlap = (source_rate as usize * 3) / 4;
                cursor += if cut.forced {
                    cut.index.saturating_sub(overlap).max(1)
                } else {
                    cut.index
                };
                prev_forced = cut.forced;
                // Loop again immediately to drain any backlog before sleeping.
                continue;
            }

            if !recording {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        (accumulated, cursor, prev_forced)
    })
}

fn norm_word(w: &str) -> String {
    w.chars()
        .filter(|c| c.is_alphanumeric() || *c == '\'')
        .collect::<String>()
        .to_lowercase()
}

/// Join a new segment onto the committed transcript, removing duplicated
/// words at the seam. After a forced cut the next segment re-hears an
/// overlap, so a 1-word match is enough (`aggressive`); otherwise require
/// ≥3 matching words so legitimate repetition is never eaten.
/// Mirrors extension/src/lib/transcript.ts.
fn join_with_dedup(committed: &str, next: &str, aggressive: bool) -> String {
    let a = committed.trim();
    let b = next.trim();
    if a.is_empty() {
        return b.to_string();
    }
    if b.is_empty() {
        return a.to_string();
    }

    let a_words: Vec<&str> = a.split_whitespace().collect();
    let b_words: Vec<&str> = b.split_whitespace().collect();
    let max_k = 8usize.min(a_words.len()).min(b_words.len());
    let min_k = if aggressive { 1 } else { 3 };

    let mut drop = 0;
    let mut k = max_k;
    while k >= min_k {
        let mut matches = true;
        for i in 0..k {
            let wa = norm_word(a_words[a_words.len() - k + i]);
            let wb = norm_word(b_words[i]);
            if wa.is_empty() || wa != wb {
                matches = false;
                break;
            }
        }
        if matches {
            drop = k;
            break;
        }
        k -= 1;
    }

    let rest = b_words[drop..].join(" ");
    if rest.is_empty() {
        a.to_string()
    } else {
        format!("{} {}", a, rest)
    }
}

// Phrases Whisper famously invents on silence/breath/noise. Only dropped
// when the audio was mostly unvoiced — a real "Thank you." is kept.
const HALLUCINATIONS: &[&str] = &[
    "thank you",
    "thanks",
    "thank you very much",
    "thanks for watching",
    "thank you for watching",
    "please subscribe",
    "please like and subscribe",
    "see you in the next video",
    "see you next time",
    "bye",
    "you",
    "so",
];

fn is_hallucination(text: &str, speech_ratio: f32) -> bool {
    let t: String = text
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '\'' || c.is_whitespace())
        .collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        return true;
    }
    speech_ratio < 0.25 && HALLUCINATIONS.contains(&t.as_str())
}

fn auto_paste_clipboard() {
    std::thread::spawn(|| {
        // Small delay to ensure clipboard is written
        std::thread::sleep(std::time::Duration::from_millis(150));
        if let Ok(mut enigo) = Enigo::new(&EnigoSettings::default()) {
            let _ = enigo.key(Key::Control, Direction::Press);
            let _ = enigo.key(Key::Unicode('v'), Direction::Click);
            let _ = enigo.key(Key::Control, Direction::Release);
        }
    });
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    audio_buf: State<'_, Arc<SharedAudioBuffer>>,
) -> Result<(), String> {
    let mut rec_state = state.recording_state.lock();
    if *rec_state == RecordingState::Recording {
        return Err("Already recording".to_string());
    }

    crate::audio::start_recording(&audio_buf)?;

    *rec_state = RecordingState::Recording;
    let _ = app.emit("recording-state-changed", "recording");
    show_indicator(&app);

    let s = settings::load();
    if s.sound_feedback {
        play_sound("start");
    }

    // Spawn the streaming worker so transcription happens progressively while
    // the user is still speaking (live captions + near-instant finalize).
    let model_path = model_manager::model_path(&s.whisper_model);
    let worker = spawn_streaming_worker(app.clone(), Arc::clone(&audio_buf), model_path);
    *state.streaming_worker.lock() = Some(worker);

    Ok(())
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    audio_buf: State<'_, Arc<SharedAudioBuffer>>,
) -> Result<TranscriptResult, String> {
    let s = settings::load();

    {
        let mut rec_state = state.recording_state.lock();
        if *rec_state != RecordingState::Recording {
            return Err("Not recording".to_string());
        }
        *rec_state = RecordingState::Processing;
        let _ = app.emit("recording-state-changed", "processing");
    }
    hide_indicator(&app);

    if s.sound_feedback {
        play_sound("stop");
    }

    // Signal both the cpal recording thread and the streaming worker to stop.
    *audio_buf.is_recording.lock() = false;

    // Join the streaming worker (off the async runtime) to get the transcript
    // it built during recording plus how far it got (raw-sample cursor).
    let handle = state.streaming_worker.lock().take();
    let (accumulated, cursor, prev_forced) = if let Some(h) = handle {
        tokio::task::spawn_blocking(move || {
            h.join().unwrap_or_else(|_| (String::new(), 0, false))
        })
        .await
        .map_err(|e| format!("Worker join error: {}", e))?
    } else {
        (String::new(), 0, false)
    };

    // Let the cpal thread flush its final buffer, then drain the tail.
    std::thread::sleep(std::time::Duration::from_millis(100));
    let model_path = model_manager::model_path(&s.whisper_model);
    let (tail_audio, duration_secs) = crate::audio::take_tail_16k(&audio_buf, cursor)?;

    let raw_transcript = if model_path.exists() {
        // Transcribe only the small remaining tail, then assemble.
        let tail_text = if crate::audio::has_speech(&tail_audio, 16000) {
            let ratio = crate::audio::speech_ratio(&tail_audio, 16000);
            let path = model_path.clone();
            let tail = tail_audio;
            let text = tokio::task::spawn_blocking(move || transcribe::transcribe(&path, &tail))
                .await
                .map_err(|e| format!("Task join error: {}", e))??;
            if is_hallucination(&text, ratio) {
                String::new()
            } else {
                text
            }
        } else {
            String::new()
        };
        join_with_dedup(&accumulated, &tail_text, prev_forced)
    } else {
        format!(
            "[Model not downloaded. Captured {:.1}s of audio. Please download the Whisper model first.]",
            duration_secs
        )
    };

    // Nothing intelligible — don't clobber the clipboard, auto-paste, or
    // pollute history with an empty entry.
    if raw_transcript.trim().is_empty() {
        {
            let mut rec_state = state.recording_state.lock();
            *rec_state = RecordingState::Idle;
        }
        let _ = app.emit("recording-state-changed", "idle");
        let _ = app.emit("no-speech", ());
        return Err("No speech detected".to_string());
    }

    let healed_transcript = if s.healing_enabled {
        healing::heal_transcript(&raw_transcript)
    } else {
        raw_transcript.clone()
    };

    // Save to history
    let entry = history::add_entry(duration_secs, &raw_transcript, &healed_transcript)?;

    let result = TranscriptResult {
        id: entry.id,
        raw: raw_transcript,
        healed: healed_transcript.clone(),
        duration_secs,
        timestamp: entry.timestamp,
    };

    *state.last_transcript.lock() = healed_transcript;

    {
        let mut rec_state = state.recording_state.lock();
        *rec_state = RecordingState::Idle;
    }

    let _ = app.emit("recording-state-changed", "idle");
    let _ = app.emit("transcript-ready", &result);

    // Auto-copy to clipboard — write directly from the backend so it works
    // regardless of whether the main webview is focused/visible (this is a
    // tray app driven by a global shortcut). Must happen before auto-paste.
    if s.auto_copy {
        match app.clipboard().write_text(result.healed.clone()) {
            Ok(()) => {
                let _ = app.emit("auto-copied", ());
            }
            Err(e) => eprintln!("Auto-copy to clipboard failed: {}", e),
        }
    }

    // Auto-paste
    if s.auto_paste {
        auto_paste_clipboard();
    }

    Ok(result)
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
            start_recording(app, state, audio_buf)?;
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
pub async fn preload_model(filename: String) -> Result<(), String> {
    let path = model_manager::model_path(&filename);
    if !path.exists() {
        return Err(format!("Model not downloaded: {}", filename));
    }
    tokio::task::spawn_blocking(move || transcribe::preload(&path))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
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
