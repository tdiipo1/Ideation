use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub shortcut: String,
    pub whisper_model: String,
    pub healing_enabled: bool,
    pub auto_paste: bool,
    pub auto_copy: bool,
    pub sound_feedback: bool,
    #[serde(default)]
    pub llm_provider: String,
    #[serde(default)]
    pub llm_api_key: String,
    #[serde(default)]
    pub llm_model: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            shortcut: "Ctrl+Shift+Space".to_string(),
            whisper_model: "ggml-base.en.bin".to_string(),
            healing_enabled: true,
            auto_paste: false,
            auto_copy: true,
            sound_feedback: true,
            llm_provider: "gemini".to_string(),
            llm_api_key: String::new(),
            llm_model: String::new(),
        }
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
        serde_json::from_str(&data).unwrap_or_default()
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
