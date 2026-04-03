import { useState, useEffect, useCallback } from "react";
import { getHistory, addToHistory, deleteFromHistory, clearHistory } from "../lib/storage";
import type { HistoryEntry } from "../types";

export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const load = useCallback(async () => {
    setEntries(await getHistory());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(
    async (entry: HistoryEntry) => {
      await addToHistory(entry);
      setEntries((prev) => [entry, ...prev].slice(0, 200));
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    await deleteFromHistory(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clear = useCallback(async () => {
    await clearHistory();
    setEntries([]);
  }, []);

  return { entries, add, remove, clear, reload: load };
}
