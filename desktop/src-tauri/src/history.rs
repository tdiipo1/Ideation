use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub id: String,
    pub timestamp: String,
    pub duration_secs: f32,
    pub raw: String,
    pub healed: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct HistoryStore {
    entries: Vec<TranscriptEntry>,
}

fn history_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("com.ideation.desktop");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("history.json")
}

fn load_store() -> HistoryStore {
    let path = history_path();
    if path.exists() {
        let data = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        HistoryStore::default()
    }
}

fn save_store(store: &HistoryStore) -> Result<(), String> {
    let path = history_path();
    let data =
        serde_json::to_string_pretty(store).map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("Write error: {}", e))?;
    Ok(())
}

pub fn add_entry(duration_secs: f32, raw: &str, healed: &str) -> Result<TranscriptEntry, String> {
    let mut store = load_store();

    let now = chrono::Local::now();
    let entry = TranscriptEntry {
        id: format!("{}", now.timestamp_millis()),
        timestamp: now.format("%Y-%m-%d %H:%M:%S").to_string(),
        duration_secs,
        raw: raw.to_string(),
        healed: healed.to_string(),
    };

    store.entries.insert(0, entry.clone());

    // Keep at most 500 entries
    store.entries.truncate(500);

    save_store(&store)?;
    Ok(entry)
}

pub fn get_entries(limit: usize, offset: usize) -> Vec<TranscriptEntry> {
    let store = load_store();
    store
        .entries
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect()
}

pub fn delete_entry(id: &str) -> Result<(), String> {
    let mut store = load_store();
    store.entries.retain(|e| e.id != id);
    save_store(&store)
}

pub fn clear_history() -> Result<(), String> {
    let store = HistoryStore::default();
    save_store(&store)
}
