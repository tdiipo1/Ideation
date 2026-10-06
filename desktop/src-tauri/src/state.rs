use parking_lot::Mutex;
use std::sync::Arc;
use std::thread::JoinHandle;

#[derive(Debug, Clone, PartialEq)]
pub enum RecordingState {
    Idle,
    Recording,
    Processing,
}

/// What the streaming worker hands back when it is joined at stop.
#[derive(Default)]
pub struct WorkerOutcome {
    /// Transcript assembled from the segments committed during recording.
    pub text: String,
    /// Raw-sample cursor: how far the worker already transcribed, so
    /// stop_recording only handles the tail.
    pub cursor: usize,
    /// Whether the last cut was forced (drives word de-dup at the final seam).
    pub prev_forced: bool,
    /// The inference session (state + locked language), reused for the tail.
    pub session: Option<crate::transcribe::Session>,
    /// The voice-activity detector the worker used, reused for the tail.
    pub vad: Option<crate::audio::Vad>,
    /// Language the session locked on, if any.
    pub language: Option<String>,
}

pub struct AppState {
    pub recording_state: Mutex<RecordingState>,
    pub last_transcript: Mutex<String>,
    // Background streaming-transcription worker, joined by stop_recording.
    pub streaming_worker: Mutex<Option<JoinHandle<WorkerOutcome>>>,
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
