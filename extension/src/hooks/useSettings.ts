import { useState, useEffect, useCallback, useRef } from "react";
import { getSettings, saveSettings } from "../lib/storage";
import type { ExtSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

export function useSettings() {
  const [settings, setSettings] = useState<ExtSettings>(DEFAULT_SETTINGS);
  // False until the stored settings have been read; callers use it to avoid
  // acting on the defaults (e.g. loading the default model, then the saved
  // one right after).
  const [loaded, setLoaded] = useState(false);
  const pendingRef = useRef<ExtSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      pendingRef.current = s;
      setLoaded(true);
    });
  }, []);

  // Update local state only (no save until explicit save)
  const update = useCallback((patch: Partial<ExtSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      pendingRef.current = next;
      return next;
    });
  }, []);

  // Explicit save to storage
  const save = useCallback(() => {
    saveSettings(pendingRef.current);
  }, []);

  return { settings, loaded, update, save };
}
