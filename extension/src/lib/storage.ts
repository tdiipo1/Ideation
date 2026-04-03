import { HistoryEntry, ExtSettings, DEFAULT_SETTINGS } from "../types";

// History
export async function getHistory(): Promise<HistoryEntry[]> {
  const data = await chrome.storage.local.get("history");
  return data.history || [];
}

export async function addToHistory(entry: HistoryEntry): Promise<void> {
  const entries = await getHistory();
  entries.unshift(entry);
  // Keep max 200
  if (entries.length > 200) entries.length = 200;
  await chrome.storage.local.set({ history: entries });
}

export async function deleteFromHistory(id: string): Promise<void> {
  const entries = await getHistory();
  await chrome.storage.local.set({
    history: entries.filter((e) => e.id !== id),
  });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ history: [] });
}

// Settings
export async function getSettings(): Promise<ExtSettings> {
  const data = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...data.settings };
}

export async function saveSettings(settings: ExtSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}
