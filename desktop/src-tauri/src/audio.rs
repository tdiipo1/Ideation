use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use parking_lot::Mutex;
use rubato::{FftFixedIn, Resampler};
use std::sync::Arc;

const TARGET_SAMPLE_RATE: u32 = 16000;

// cpal::Stream is !Send, so we use a thread-confined approach.
// The stream lives on a dedicated thread and we communicate via shared buffer.
pub struct SharedAudioBuffer {
    pub samples: Mutex<Vec<f32>>,
    pub is_recording: Mutex<bool>,
    pub source_sample_rate: Mutex<u32>,
    /// Set by the capture thread when it fails (no device, unsupported format,
    /// stream error). Readers use it to turn a silent failure into a visible one.
    pub last_error: Mutex<Option<String>>,
}

impl SharedAudioBuffer {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            samples: Mutex::new(Vec::new()),
            is_recording: Mutex::new(false),
            source_sample_rate: Mutex::new(44100),
            last_error: Mutex::new(None),
        })
    }
}

/// Bring quiet recordings up to a usable level before VAD and inference.
/// Desktop capture has no automatic gain control, so a soft-spoken user on a
/// low-gain mic can sit entirely under the silence floor and be reported as
/// "no speech". Scaling is peak-based and capped so noise isn't blown up.
pub fn normalize_gain(audio: &mut [f32]) {
    let peak = audio.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    if peak > 0.001 && peak < 0.05 {
        let gain = (0.3 / peak).min(10.0);
        for x in audio.iter_mut() {
            *x *= gain;
        }
    }
}

/// Start recording on a new thread. Returns immediately.
/// The stream and thread live until `is_recording` is set to false.
pub fn start_recording(buffer: &Arc<SharedAudioBuffer>) -> Result<(), String> {
    {
        let mut recording = buffer.is_recording.lock();
        if *recording {
            return Err("Already recording".to_string());
        }
        *recording = true;
    }
    buffer.samples.lock().clear();
    *buffer.last_error.lock() = None;

    let buffer = buffer.clone();
    std::thread::spawn(move || {
        if let Err(e) = run_recording_thread(&buffer) {
            eprintln!("Recording thread error: {}", e);
            *buffer.last_error.lock() = Some(e);
            *buffer.is_recording.lock() = false;
        }
    });

    Ok(())
}

fn run_recording_thread(buffer: &Arc<SharedAudioBuffer>) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No input device available")?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get input config: {}", e))?;

    *buffer.source_sample_rate.lock() = config.sample_rate().0;
    let channels = config.channels() as usize;

    let err_fn = |err: cpal::StreamError| {
        eprintln!("Audio stream error: {}", err);
    };

    let stream: Stream = match config.sample_format() {
        SampleFormat::F32 => {
            let buf = buffer.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    // Average all channels: a mic wired to the right channel
                    // only would otherwise record silence.
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
                        .collect();
                    buf.samples.lock().extend_from_slice(&mono);
                },
                err_fn,
                None,
            )
        }
        SampleFormat::I16 => {
            let buf = buffer.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| {
                            frame.iter().map(|&s| s as f32 / 32768.0).sum::<f32>()
                                / frame.len() as f32
                        })
                        .collect();
                    buf.samples.lock().extend_from_slice(&mono);
                },
                err_fn,
                None,
            )
        }
        SampleFormat::U16 => {
            let buf = buffer.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| {
                            frame
                                .iter()
                                .map(|&s| (s as f32 - 32768.0) / 32768.0)
                                .sum::<f32>()
                                / frame.len() as f32
                        })
                        .collect();
                    buf.samples.lock().extend_from_slice(&mono);
                },
                err_fn,
                None,
            )
        }
        format => return Err(format!("Unsupported sample format: {:?}", format)),
    }
    .map_err(|e| format!("Failed to build input stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    // Keep thread alive while recording
    while *buffer.is_recording.lock() {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    // Stream is dropped here, stopping the recording
    drop(stream);
    Ok(())
}

/// Resample arbitrary mono f32 samples to 16kHz (Whisper's rate).
/// Passthrough when already at 16kHz. Used to resample individual streaming
/// segments independently of the full buffer.
pub fn resample_to_16k(input: &[f32], from_rate: u32) -> Result<Vec<f32>, String> {
    if input.is_empty() {
        return Ok(Vec::new());
    }
    if from_rate == TARGET_SAMPLE_RATE {
        return Ok(input.to_vec());
    }
    resample(input, from_rate, TARGET_SAMPLE_RATE)
}

/// Drain all captured raw samples and return the resampled-to-16kHz tail
/// (everything from `cursor` onward) plus the total recording duration in
/// seconds. `cursor` is an index into the raw device-rate sample buffer —
/// the streaming worker reports how far it already transcribed.
pub fn take_tail_16k(
    buffer: &Arc<SharedAudioBuffer>,
    cursor: usize,
) -> Result<(Vec<f32>, f32), String> {
    let raw = {
        let mut buf = buffer.samples.lock();
        std::mem::take(&mut *buf)
    };
    if raw.is_empty() {
        return Err("No audio captured".to_string());
    }
    let source_rate = *buffer.source_sample_rate.lock();
    let duration_secs = raw.len() as f32 / source_rate as f32;
    let tail = if cursor < raw.len() {
        resample_to_16k(&raw[cursor..], source_rate)?
    } else {
        Vec::new()
    };
    Ok((tail, duration_secs))
}

// --- Energy-based VAD for streaming chunk boundaries ---
// Mirrors extension/src/lib/vad.ts so both frontends segment audio the same
// way. We cut at silence so Whisper never sees a word sliced mid-utterance.
const VAD_FRAME_MS: usize = 30;
const VAD_MIN_SEGMENT_MS: usize = 3000;
const VAD_HARD_CAP_MS: usize = 20000;
const VAD_SILENCE_MS: usize = 400;
const VAD_ABS_FLOOR: f32 = 0.004;

fn frame_rms(audio: &[f32]) -> f32 {
    if audio.is_empty() {
        return 0.0;
    }
    let sum: f32 = audio.iter().map(|x| x * x).sum();
    (sum / audio.len() as f32).sqrt()
}

/// A chosen chunk boundary. `forced` is true when the cut happened at the
/// hard cap (continuous speech, no pause found) rather than at silence —
/// forced cuts get an overlap + word de-dup to avoid clipping words.
pub struct CutPoint {
    pub index: usize,
    pub forced: bool,
}

/// Find a sample index (relative to the start of `audio`) to commit up to,
/// or None if it's not yet time to cut. `audio` should be the un-committed
/// region (i.e. already sliced from the cursor).
pub fn find_cut_point(audio: &[f32], sample_rate: u32) -> Option<CutPoint> {
    let sr = sample_rate as usize;
    let frame = VAD_FRAME_MS * sr / 1000;
    if frame == 0 {
        return None;
    }
    let min_seg = VAD_MIN_SEGMENT_MS * sr / 1000;
    let hard_cap = VAD_HARD_CAP_MS * sr / 1000;
    let silence = VAD_SILENCE_MS * sr / 1000;

    let len = audio.len();
    if len < min_seg {
        return None;
    }

    // Noise floor relative to the loudest frame in the region.
    let mut peak = 0.0f32;
    let mut s = 0;
    while s + frame <= len {
        let rms = frame_rms(&audio[s..s + frame]);
        if rms > peak {
            peak = rms;
        }
        s += frame;
    }
    let threshold = VAD_ABS_FLOOR.max(0.2 * peak);

    // Scan for a silence run beginning at least min_seg past the start.
    let mut run_start: isize = -1;
    let mut lowest = f32::INFINITY;
    let mut lowest_sample: isize = -1;
    let mut s = min_seg;
    while s + frame <= len {
        let rms = frame_rms(&audio[s..s + frame]);
        if rms < lowest {
            lowest = rms;
            lowest_sample = s as isize;
        }
        if rms < threshold {
            if run_start == -1 {
                run_start = s as isize;
            }
            if (s + frame) as isize - run_start >= silence as isize {
                return Some(CutPoint {
                    index: run_start as usize,
                    forced: false,
                });
            }
        } else {
            run_start = -1;
        }
        s += frame;
    }

    // No pause, but region too long — force a cut at the quietest frame.
    if len >= hard_cap && lowest_sample > 0 {
        return Some(CutPoint {
            index: lowest_sample as usize,
            forced: true,
        });
    }
    None
}

/// Fraction of frames above the silence floor (0..1). Used to distinguish
/// real speech from breath/noise blips when filtering Whisper's classic
/// silence hallucinations ("Thank you." etc.).
pub fn speech_ratio(audio: &[f32], sample_rate: u32) -> f32 {
    let frame = VAD_FRAME_MS * sample_rate as usize / 1000;
    if frame == 0 || audio.len() < frame {
        return 0.0;
    }
    let mut voiced = 0u32;
    let mut frames = 0u32;
    let mut s = 0;
    while s + frame <= audio.len() {
        if frame_rms(&audio[s..s + frame]) >= VAD_ABS_FLOOR {
            voiced += 1;
        }
        frames += 1;
        s += frame;
    }
    if frames == 0 {
        0.0
    } else {
        voiced as f32 / frames as f32
    }
}

/// Whether the audio contains any speech above the silence floor.
pub fn has_speech(audio: &[f32], sample_rate: u32) -> bool {
    let sr = sample_rate as usize;
    let frame = VAD_FRAME_MS * sr / 1000;
    if frame == 0 || audio.len() < frame {
        return false;
    }
    let mut s = 0;
    while s + frame <= audio.len() {
        if frame_rms(&audio[s..s + frame]) >= VAD_ABS_FLOOR {
            return true;
        }
        s += frame;
    }
    false
}

fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> Result<Vec<f32>, String> {
    let chunk_size = 1024;
    let mut resampler = FftFixedIn::<f32>::new(
        from_rate as usize,
        to_rate as usize,
        chunk_size,
        1, // sub_chunks
        1, // channels (mono)
    )
    .map_err(|e| format!("Failed to create resampler: {}", e))?;

    let mut output = Vec::new();
    let input_frames = input.len();
    let mut pos = 0;

    while pos + chunk_size <= input_frames {
        let chunk = vec![input[pos..pos + chunk_size].to_vec()];
        let resampled = resampler
            .process(&chunk, None)
            .map_err(|e| format!("Resample error: {}", e))?;
        output.extend_from_slice(&resampled[0]);
        pos += chunk_size;
    }

    // Handle remaining samples by zero-padding to chunk_size
    if pos < input_frames {
        let mut last_chunk = input[pos..].to_vec();
        last_chunk.resize(chunk_size, 0.0);
        let chunk = vec![last_chunk];
        let resampled = resampler
            .process(&chunk, None)
            .map_err(|e| format!("Resample error: {}", e))?;
        let expected_out =
            ((input_frames - pos) as f64 * to_rate as f64 / from_rate as f64) as usize;
        let take = expected_out.min(resampled[0].len());
        output.extend_from_slice(&resampled[0][..take]);
    }

    Ok(output)
}
