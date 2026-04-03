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
}

impl SharedAudioBuffer {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            samples: Mutex::new(Vec::new()),
            is_recording: Mutex::new(false),
            source_sample_rate: Mutex::new(44100),
        })
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

    let buffer = buffer.clone();
    std::thread::spawn(move || {
        if let Err(e) = run_recording_thread(&buffer) {
            eprintln!("Recording thread error: {}", e);
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
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
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
                                / channels as f32
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
                                / channels as f32
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

/// Stop recording and return resampled 16kHz mono audio.
pub fn stop_recording(buffer: &Arc<SharedAudioBuffer>) -> Result<Vec<f32>, String> {
    *buffer.is_recording.lock() = false;

    // Give the thread a moment to stop
    std::thread::sleep(std::time::Duration::from_millis(100));

    let raw_audio = {
        let buf = buffer.samples.lock();
        buf.clone()
    };

    if raw_audio.is_empty() {
        return Err("No audio captured".to_string());
    }

    let source_rate = *buffer.source_sample_rate.lock();

    if source_rate == TARGET_SAMPLE_RATE {
        return Ok(raw_audio);
    }

    resample(&raw_audio, source_rate, TARGET_SAMPLE_RATE)
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
