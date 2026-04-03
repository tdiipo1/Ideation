use parking_lot::Mutex;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq)]
pub enum RecordingState {
    Idle,
    Recording,
    Processing,
}

pub struct AppState {
    pub recording_state: Mutex<RecordingState>,
    pub audio_buffer: Mutex<Vec<f32>>,
    pub last_transcript: Mutex<String>,
}

impl AppState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            recording_state: Mutex::new(RecordingState::Idle),
            audio_buffer: Mutex::new(Vec::new()),
            last_transcript: Mutex::new(String::new()),
        })
    }
}
