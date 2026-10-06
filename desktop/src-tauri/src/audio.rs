//! Microphone capture (cpal) into a shared 16 kHz mono buffer, plus voice
//! activity detection used to pick streaming chunk boundaries.
//!
//! Capture is downsampled on the fly with a persistent resampler, so the
//! buffer is always at Whisper's rate and chunk boundaries lose nothing (the
//! old per-segment resampler dropped ~20–30 ms at every boundary).
//!
//! Segmentation prefers whisper.cpp's Silero VAD, loaded standalone — the
//! `full()` path whisper-rs uses ignores the VAD params — and falls back to
//! an energy detector when the VAD model isn't on disk. The energy detector
//! mirrors extension/src/lib/vad.ts.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use parking_lot::Mutex;
use rubato::{FftFixedIn, Resampler};
use std::path::Path;
use std::sync::Arc;
use whisper_rs::{WhisperVadContext, WhisperVadContextParams, WhisperVadParams};

/// Rate of the shared buffer (Whisper's input rate).
pub const SAMPLE_RATE: u32 = 16000;
const SR: usize = SAMPLE_RATE as usize;

// cpal::Stream is !Send, so we use a thread-confined approach.
// The stream lives on a dedicated thread and we communicate via shared buffer.
pub struct SharedAudioBuffer {
    /// Captured audio: mono, 16 kHz.
    pub samples: Mutex<Vec<f32>>,
    pub is_recording: Mutex<bool>,
    /// Native rate of the capture device (informational; the buffer is 16 kHz).
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

fn gcd(a: usize, b: usize) -> usize {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// Persistent device-rate → 16 kHz converter fed from the capture callback.
///
/// The input chunk is a multiple of the resampler's FFT frame (device rate /
/// gcd(device rate, 16 kHz): 3 frames for 48 kHz, 441 for 44.1 kHz). With
/// any other chunk size rubato buffers input internally and the stream
/// comes out short; with this one every call yields exactly chunk × ratio
/// samples, delayed by `output_delay()`, which `skip`/`flush` compensate.
struct Downsampler {
    /// None when the device already runs at 16 kHz.
    resampler: Option<FftFixedIn<f32>>,
    pending: Vec<f32>,
    chunk: usize,
    from_rate: u32,
    /// Filter warm-up samples still to drop from the start of the output.
    skip: usize,
}

impl Downsampler {
    fn new(from_rate: u32) -> Result<Self, String> {
        let from = from_rate as usize;
        let frame_in = from / gcd(from, SR);
        // About 20 ms of input per call, rounded up to whole FFT frames.
        let chunk = frame_in * (from / 50).div_ceil(frame_in).max(1);
        let (resampler, skip) = if from_rate == SAMPLE_RATE {
            (None, 0)
        } else {
            let rs = FftFixedIn::<f32>::new(from, SR, chunk, 1, 1)
                .map_err(|e| format!("Failed to create resampler: {}", e))?;
            let skip = rs.output_delay();
            (Some(rs), skip)
        };
        Ok(Self {
            resampler,
            pending: Vec::with_capacity(chunk * 2),
            chunk,
            from_rate,
            skip,
        })
    }

    fn emit(&mut self, produced: &[f32], out: &mut Vec<f32>) {
        let drop = self.skip.min(produced.len());
        self.skip -= drop;
        out.extend_from_slice(&produced[drop..]);
    }

    fn push(&mut self, mono: &[f32], out: &mut Vec<f32>) {
        if self.resampler.is_none() {
            out.extend_from_slice(mono);
            return;
        }
        self.pending.extend_from_slice(mono);
        while self.pending.len() >= self.chunk {
            let input: Vec<f32> = self.pending.drain(..self.chunk).collect();
            let produced = match self.resampler.as_mut().unwrap().process(&[input], None) {
                Ok(res) => res.into_iter().next().unwrap_or_default(),
                Err(e) => {
                    eprintln!("Resample error: {}", e);
                    continue;
                }
            };
            self.emit(&produced, out);
        }
    }

    /// Push out what the resampler still holds (partial chunk + filter delay).
    fn flush(&mut self, out: &mut Vec<f32>) {
        if self.resampler.is_none() {
            return;
        }
        let remaining = self.pending.len();
        let expected = (remaining as f64 * SR as f64 / self.from_rate as f64).round() as usize;
        let mut last: Vec<f32> = self.pending.drain(..).collect();
        last.resize(self.chunk, 0.0);
        let delay = self.resampler.as_ref().unwrap().output_delay();
        if let Ok(res) = self.resampler.as_mut().unwrap().process(&[last], None) {
            let produced = res.into_iter().next().unwrap_or_default();
            let take = (expected + delay).min(produced.len());
            self.emit(&produced[..take], out);
            let short = (expected + delay).saturating_sub(take);
            if short > 0 {
                // The real tail is still inside the filter: push silence through.
                let zeros = vec![0.0f32; self.chunk];
                if let Ok(res) = self.resampler.as_mut().unwrap().process(&[zeros], None) {
                    let produced = res.into_iter().next().unwrap_or_default();
                    self.emit(&produced[..short.min(produced.len())], out);
                }
            }
        }
    }
}

/// Average all channels into mono: a mic wired to the right channel only
/// would otherwise record silence.
fn downmix<T: Copy>(data: &[T], channels: usize, conv: impl Fn(T) -> f32) -> Vec<f32> {
    data.chunks(channels.max(1))
        .map(|frame| frame.iter().map(|&s| conv(s)).sum::<f32>() / frame.len() as f32)
        .collect()
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

    let source_rate = config.sample_rate().0;
    *buffer.source_sample_rate.lock() = source_rate;
    let channels = config.channels() as usize;
    let down = Arc::new(Mutex::new(Downsampler::new(source_rate)?));

    let err_fn = |err: cpal::StreamError| {
        eprintln!("Audio stream error: {}", err);
    };

    let stream: Stream = match config.sample_format() {
        SampleFormat::F32 => {
            let buf = buffer.clone();
            let ds = down.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let mono = downmix(data, channels, |s| s);
                    ds.lock().push(&mono, &mut buf.samples.lock());
                },
                err_fn,
                None,
            )
        }
        SampleFormat::I16 => {
            let buf = buffer.clone();
            let ds = down.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let mono = downmix(data, channels, |s| s as f32 / 32768.0);
                    ds.lock().push(&mono, &mut buf.samples.lock());
                },
                err_fn,
                None,
            )
        }
        SampleFormat::U16 => {
            let buf = buffer.clone();
            let ds = down.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    let mono = downmix(data, channels, |s| (s as f32 - 32768.0) / 32768.0);
                    ds.lock().push(&mono, &mut buf.samples.lock());
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

    // Stream is dropped here, stopping the recording; then release what the
    // resampler still holds.
    drop(stream);
    down.lock().flush(&mut buffer.samples.lock());
    Ok(())
}

/// Drain all captured samples and return the tail (everything from `cursor`
/// onward, 16 kHz) plus the total recording duration in seconds. `cursor` is
/// how far the streaming worker already transcribed.
pub fn take_tail(buffer: &Arc<SharedAudioBuffer>, cursor: usize) -> Result<(Vec<f32>, f32), String> {
    let raw = {
        let mut buf = buffer.samples.lock();
        std::mem::take(&mut *buf)
    };
    if raw.is_empty() {
        return Err("No audio captured".to_string());
    }
    let duration_secs = raw.len() as f32 / SR as f32;
    let tail = if cursor < raw.len() {
        raw[cursor..].to_vec()
    } else {
        Vec::new()
    };
    Ok((tail, duration_secs))
}

// --- Voice activity detection for streaming chunk boundaries ---
// We cut at silence so Whisper never sees a word sliced mid-utterance.
const VAD_FRAME_MS: usize = 30;
const VAD_ABS_FLOOR: f32 = 0.004;
/// Don't commit segments shorter than this (raised adaptively on slow machines).
pub const DEFAULT_MIN_SEGMENT_SECS: f32 = 3.0;
pub const MAX_MIN_SEGMENT_SECS: f32 = 10.0;
/// Force a cut beyond this (Whisper's window is 30 s).
const HARD_CAP_SECS: usize = 20;
/// A pause this long after speech is a safe place to cut.
const GAP_MIN_MS: usize = 400;
/// Keep this much of the pause after the speech so the last word isn't clipped.
const CUT_PAD_MS: usize = 200;

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

/// whisper.cpp's Silero VAD, driven standalone.
pub struct SileroVad {
    ctx: WhisperVadContext,
}

impl SileroVad {
    pub fn load(path: &Path) -> Option<Self> {
        if !path.exists() {
            return None;
        }
        let mut cp = WhisperVadContextParams::new();
        cp.set_n_threads(2);
        match WhisperVadContext::new(path.to_str()?, cp) {
            Ok(ctx) => Some(Self { ctx }),
            Err(e) => {
                eprintln!("Failed to load VAD model ({}): {:?}", path.display(), e);
                None
            }
        }
    }

    /// Speech regions as 16 kHz sample ranges, in order.
    pub fn speech_regions(&mut self, audio: &[f32]) -> Vec<(usize, usize)> {
        if audio.len() < 512 {
            return Vec::new();
        }
        let mut p = WhisperVadParams::new();
        p.set_threshold(0.5);
        p.set_min_speech_duration(250);
        p.set_min_silence_duration(300);
        p.set_speech_pad(60);
        p.set_max_speech_duration(f32::MAX);
        match self.ctx.segments_from_samples(p, audio) {
            Ok(segments) => segments
                .map(|s| {
                    let start = ((s.start * SR as f32 / 100.0) as usize).min(audio.len());
                    let end = ((s.end * SR as f32 / 100.0) as usize).min(audio.len());
                    (start, end)
                })
                .filter(|(a, b)| b > a)
                .collect(),
            Err(e) => {
                eprintln!("VAD failed: {:?}", e);
                Vec::new()
            }
        }
    }
}

/// The detector in use: Silero when its model is on disk, energy otherwise.
pub enum Vad {
    Silero(SileroVad),
    Energy,
}

impl Vad {
    pub fn load(vad_model_path: &Path) -> Vad {
        match SileroVad::load(vad_model_path) {
            Some(v) => Vad::Silero(v),
            None => Vad::Energy,
        }
    }

    pub fn speech_regions(&mut self, audio: &[f32]) -> Vec<(usize, usize)> {
        match self {
            Vad::Silero(v) => v.speech_regions(audio),
            Vad::Energy => energy_regions(audio),
        }
    }
}

/// Energy-based speech regions (16 kHz): runs of 30 ms frames above a floor
/// that adapts to the loudest frame in the clip. Fallback when Silero isn't
/// available; mirrors the extension's detector.
pub fn energy_regions(audio: &[f32]) -> Vec<(usize, usize)> {
    let frame = SR * VAD_FRAME_MS / 1000;
    if audio.len() < frame {
        return Vec::new();
    }
    let mut peak = 0.0f32;
    let mut s = 0;
    while s + frame <= audio.len() {
        peak = peak.max(frame_rms(&audio[s..s + frame]));
        s += frame;
    }
    let threshold = VAD_ABS_FLOOR.max(0.2 * peak);

    let mut regions: Vec<(usize, usize)> = Vec::new();
    let mut run_start: Option<usize> = None;
    let mut s = 0;
    while s + frame <= audio.len() {
        let voiced = frame_rms(&audio[s..s + frame]) >= threshold;
        match (voiced, run_start) {
            (true, None) => run_start = Some(s),
            (false, Some(start)) => {
                // Merge with the previous region when the gap is tiny (a
                // plosive or a breath inside a word).
                if let Some(last) = regions.last_mut() {
                    if start - last.1 < frame * 3 {
                        last.1 = s;
                        run_start = None;
                        s += frame;
                        continue;
                    }
                }
                regions.push((start, s));
                run_start = None;
            }
            _ => {}
        }
        s += frame;
    }
    if let Some(start) = run_start {
        regions.push((start, audio.len()));
    }
    regions
}

/// Decide where to cut the un-committed region given its speech regions.
/// - After a speech region that ends ≥ `min_segment_secs` in and is followed
///   by ≥ 400 ms of silence: cut 200 ms after the speech (not forced).
/// - Region ≥ 20 s with no such pause: forced cut at the longest internal
///   gap, else at the hard cap.
/// - Region ≥ `min_segment_secs` with no speech at all: cut everything (the
///   caller sees no speech and just advances).
pub fn cut_from_regions(
    len: usize,
    regions: &[(usize, usize)],
    min_segment_secs: f32,
) -> Option<CutPoint> {
    let min_seg = (min_segment_secs * SR as f32) as usize;
    let hard_cap = HARD_CAP_SECS * SR;
    let gap_min = SR * GAP_MIN_MS / 1000;
    let pad = SR * CUT_PAD_MS / 1000;
    if len < min_seg {
        return None;
    }
    if regions.is_empty() {
        return Some(CutPoint {
            index: len,
            forced: false,
        });
    }
    for (i, (_, end)) in regions.iter().enumerate() {
        if *end < min_seg {
            continue;
        }
        let next_start = regions.get(i + 1).map(|r| r.0).unwrap_or(len);
        if next_start.saturating_sub(*end) >= gap_min {
            return Some(CutPoint {
                index: (end + pad).min(len),
                forced: false,
            });
        }
    }
    if len >= hard_cap {
        let mut best: Option<(usize, usize)> = None; // (gap length, cut position)
        for w in regions.windows(2) {
            let gap = w[1].0.saturating_sub(w[0].1);
            if gap > 0 && w[0].1 >= min_seg && best.map(|b| gap > b.0).unwrap_or(true) {
                best = Some((gap, w[0].1 + gap / 2));
            }
        }
        return Some(CutPoint {
            index: best.map(|b| b.1).unwrap_or(hard_cap.min(len)),
            forced: true,
        });
    }
    None
}

/// The parts of `regions` that fall inside `[0, end)`.
pub fn clip_regions(regions: &[(usize, usize)], end: usize) -> Vec<(usize, usize)> {
    regions
        .iter()
        .filter(|(a, _)| *a < end)
        .map(|(a, b)| (*a, (*b).min(end)))
        .filter(|(a, b)| b > a)
        .collect()
}

/// Seconds of speech in the regions.
pub fn speech_secs(regions: &[(usize, usize)]) -> f32 {
    regions.iter().map(|(a, b)| (b - a) as f32).sum::<f32>() / SR as f32
}

/// Fraction of the clip that is speech (0..1). Used to distinguish real
/// speech from breath/noise blips when filtering Whisper's classic silence
/// hallucinations ("Thank you." etc.).
pub fn speech_fraction(len: usize, regions: &[(usize, usize)]) -> f32 {
    if len == 0 {
        return 0.0;
    }
    (regions.iter().map(|(a, b)| b - a).sum::<usize>() as f32 / len as f32).min(1.0)
}


/// Split a long clip into pieces Whisper can take in one window (≤ 28 s),
/// cutting at the quietest 30 ms frame between 18 s and 28 s of each piece so
/// a word is never sliced. Returns `(start, end)` sample ranges.
pub fn split_for_whisper(audio: &[f32], sample_rate: u32) -> Vec<(usize, usize)> {
    let sr = sample_rate as usize;
    let max = 28 * sr;
    if audio.len() <= max {
        return vec![(0, audio.len())];
    }
    let frame = (VAD_FRAME_MS * sr / 1000).max(1);
    let mut pieces = Vec::new();
    let mut start = 0usize;
    while audio.len() - start > max {
        let lo = start + 18 * sr;
        let hi = (start + max).min(audio.len());
        let mut best = start + 25 * sr;
        let mut best_rms = f32::INFINITY;
        let mut s = lo;
        while s + frame <= hi {
            let rms = frame_rms(&audio[s..s + frame]);
            if rms < best_rms {
                best_rms = rms;
                best = s;
            }
            s += frame;
        }
        pieces.push((start, best));
        start = best;
    }
    pieces.push((start, audio.len()));
    pieces
}

/// Offline resampling of a whole clip (used by the bench test).
#[allow(dead_code)]
pub fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> Result<Vec<f32>, String> {
    if from_rate == to_rate {
        return Ok(input.to_vec());
    }
    let mut ds = Downsampler::new(from_rate)?;
    if to_rate != SAMPLE_RATE {
        return Err("Only resampling to 16 kHz is supported".to_string());
    }
    let mut out = Vec::with_capacity(input.len() * SR / from_rate as usize + 2048);
    ds.push(input, &mut out);
    ds.flush(&mut out);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(secs: f32, amp: f32) -> Vec<f32> {
        (0..(secs * SR as f32) as usize)
            .map(|i| (i as f32 * 440.0 * 2.0 * std::f32::consts::PI / SR as f32).sin() * amp)
            .collect()
    }

    #[test]
    fn energy_regions_find_speech_and_gaps() {
        let mut audio = tone(2.0, 0.3);
        audio.extend(vec![0.0; SR]); // 1 s pause
        audio.extend(tone(1.5, 0.3));
        let regions = energy_regions(&audio);
        assert_eq!(regions.len(), 2);
        assert!(regions[0].0 < SR / 10);
        assert!((regions[0].1 as i64 - 2 * SR as i64).abs() < (SR / 10) as i64);
        assert!((regions[1].0 as i64 - 3 * SR as i64).abs() < (SR / 10) as i64);
    }

    #[test]
    fn cuts_after_a_pause_but_not_before_min_segment() {
        // Speech 0–3.5 s, pause 3.5–4.5 s, speech 4.5–6 s.
        let regions = vec![(0, 35 * SR / 10), (45 * SR / 10, 6 * SR)];
        let cut = cut_from_regions(6 * SR, &regions, 3.0).expect("cut expected");
        assert!(!cut.forced);
        assert_eq!(cut.index, 35 * SR / 10 + SR / 5);
        // Same shape but the first region ends before the minimum: no cut yet
        // (the second region is still running at the end of the clip).
        let regions = vec![(0, 2 * SR), (3 * SR, 6 * SR)];
        assert!(cut_from_regions(6 * SR, &regions, 3.0).is_none());
    }

    #[test]
    fn forces_a_cut_at_the_hard_cap() {
        let regions = vec![(0, 21 * SR)];
        let cut = cut_from_regions(21 * SR, &regions, 3.0).expect("forced cut");
        assert!(cut.forced);
        assert_eq!(cut.index, 20 * SR);
    }

    #[test]
    fn silence_is_cut_away() {
        let cut = cut_from_regions(4 * SR, &[], 3.0).expect("silence cut");
        assert!(!cut.forced);
        assert_eq!(cut.index, 4 * SR);
    }

    #[test]
    fn downsampler_keeps_length_and_content() {
        for (from, n) in [(48000u32, 16000usize), (44100, 22050), (48000, 48000 + 123)] {
            let input: Vec<f32> = (0..n)
                .map(|i| (i as f32 * 440.0 * 2.0 * std::f32::consts::PI / from as f32).sin() * 0.5)
                .collect();
            let out = resample(&input, from, 16000).unwrap();
            let expected = (n as f64 * 16000.0 / from as f64).round() as i64;
            assert!(
                (out.len() as i64 - expected).abs() <= 2,
                "{} Hz: {} vs {}",
                from,
                out.len(),
                expected
            );
            // The tone must survive end to end (no warm-up zeros, no lost tail).
            let head = out[..160].iter().fold(0.0f32, |m, x| m.max(x.abs()));
            let tail = out[out.len() - 160..].iter().fold(0.0f32, |m, x| m.max(x.abs()));
            assert!(head > 0.3 && tail > 0.3, "{} Hz: head {} tail {}", from, head, tail);
        }
    }
}
