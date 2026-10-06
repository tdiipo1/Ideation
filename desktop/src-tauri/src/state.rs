use parking_lot::Mutex;
use std::sync::Arc;
use std::thread::JoinHandle;

#[derive(Debug, Clone, PartialEq)]
pub enum RecordingState {
    Idle,
    Recording,
    Processing,
}

pub struct AppState {
    pub recording_state: Mutex<RecordingState>,
    pub last_transcript: Mutex<String>,
    // Background streaming-transcription worker. Returns (accumulated_text,
    // raw_sample_cursor, last_cut_was_forced) when joined at stop. The cursor
    // tells stop_recording how far the worker already transcribed so it only
    // handles the tail; the forced flag drives word de-dup at the final seam.
    pub streaming_worker: Mutex<Option<JoinHandle<(String, usize, bool)>>>,
}

impl AppState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            recording_state: Mutex::new(RecordingState::Idle),
            last_transcript: Mutex::new(String::new()),
            streaming_worker: Mutex::new(None),
        })
    }
}
