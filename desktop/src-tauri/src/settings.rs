use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// Every field carries a serde default: a settings file written by an older
// version (missing new keys) must load with the new keys at their defaults,
// not silently reset every setting (which is what a parse failure did).
fn d_shortcut() -> String {
    "Ctrl+Shift+Space".to_string()
}
fn d_model() -> String {
    "ggml-base.en.bin".to_string()
}
fn d_true() -> bool {
    true
}
fn d_gemini() -> String {
    "gemini".to_string()
}
fn d_auto() -> String {
    "auto".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "d_shortcut")]
    pub shortcut: String,
    #[serde(default = "d_model")]
    pub whisper_model: String,
    #[serde(default = "d_true")]
    pub healing_enabled: bool,
    #[serde(default)]
    pub auto_paste: bool,
    #[serde(default = "d_true")]
    pub auto_copy: bool,
    #[serde(default = "d_true")]
    pub sound_feedback: bool,
    #[serde(default = "d_gemini")]
    pub llm_provider: String,
    #[serde(default)]
    pub llm_api_key: String,
    #[serde(default)]
    pub llm_model: String,
    /// Spoken language: "auto" (detect once per recording, then lock) or an
    /// ISO-639-1 code such as "es" or "zh".
    #[serde(default = "d_auto")]
    pub language: String,
    /// Optional LLM pass that fixes misheard words using sentence context.
    #[serde(default)]
    pub smart_correction: bool,
    /// Use the GPU backend when the binary was built with one.
    #[serde(default = "d_true")]
    pub use_gpu: bool,
    /// Interface language: "auto" follows the system, else "en" / "es" / "zh".
    #[serde(default = "d_auto")]
    pub ui_language: String,
    /// The one-time "switch to a multilingual model" banner was dismissed.
    #[serde(default)]
    pub model_nudge_dismissed: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            shortcut: d_shortcut(),
            whisper_model: d_model(),
            healing_enabled: true,
            auto_paste: false,
            auto_copy: true,
            sound_feedback: true,
            llm_provider: d_gemini(),
            llm_api_key: String::new(),
            llm_model: String::new(),
            language: d_auto(),
            smart_correction: false,
            use_gpu: true,
            ui_language: d_auto(),
            model_nudge_dismissed: false,
        }
    }
}

impl AppSettings {
    /// Clamp values that other code relies on being well-formed.
    fn normalize(mut self) -> Self {
        if self.language != "auto" && whisper_rs::get_lang_id(&self.language).is_none() {
            self.language = d_auto();
        }
        if self.ui_language != "auto" && !matches!(self.ui_language.as_str(), "en" | "es" | "zh") {
            self.ui_language = d_auto();
        }
        self
    }
}

fn settings_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("com.ideation.desktop");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("settings.json")
}

pub fn load() -> AppSettings {
    let path = settings_path();
    if path.exists() {
        let data = std::fs::read_to_string(&path).unwrap_or_default();
        match serde_json::from_str::<AppSettings>(&data) {
            Ok(s) => s.normalize(),
            Err(e) => {
                eprintln!("Settings file unreadable ({}); using defaults", e);
                AppSettings::default()
            }
        }
    } else {
        let settings = AppSettings::default();
        let _ = save(&settings);
        settings
    }
}

pub fn save(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path();
    let data =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("Write error: {}", e))?;
    Ok(())
}
