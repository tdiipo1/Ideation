use crate::audio::SharedAudioBuffer;
use crate::healing;
use crate::history;
use crate::model_manager;
use crate::settings::{self, AppSettings};
use crate::state::{AppState, RecordingState};
use crate::transcribe;
use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

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

    let audio_data = crate::audio::stop_recording(&audio_buf)?;
    let duration_secs = audio_data.len() as f32 / 16000.0;

    // Use configured model
    let model_path = model_manager::model_path(&s.whisper_model);

    let raw_transcript = if model_path.exists() {
        let path = model_path.clone();
        tokio::task::spawn_blocking(move || transcribe::transcribe(&path, &audio_data))
            .await
            .map_err(|e| format!("Task join error: {}", e))??
    } else {
        format!(
            "[Model not downloaded. Captured {:.1}s of audio. Please download the Whisper model first.]",
            duration_secs
        )
    };

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
    *state.audio_buffer.lock() = Vec::new();

    {
        let mut rec_state = state.recording_state.lock();
        *rec_state = RecordingState::Idle;
    }

    let _ = app.emit("recording-state-changed", "idle");
    let _ = app.emit("transcript-ready", &result);

    // Auto-copy to clipboard
    if s.auto_copy {
        let _ = app.emit("auto-copy", &result.healed);
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
pub async fn structure_as_prompt(transcript: String) -> Result<String, String> {
    let s = settings::load();
    if s.llm_api_key.is_empty() {
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

    crate::structuring::structure_prompt(&config, &transcript).await
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
