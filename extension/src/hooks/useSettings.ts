import { useState, useEffect, useCallback, useRef } from "react";
import { getSettings, saveSettings } from "../lib/storage";
import type { ExtSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

export function useSettings() {
  const [settings, setSettings] = useState<ExtSettings>(DEFAULT_SETTINGS);
  const pendingRef = useRef<ExtSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      pendingRef.current = s;
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

  return { settings, update, save };
}
