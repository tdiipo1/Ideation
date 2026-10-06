// UI strings come from public/_locales/<locale>/messages.json via Chrome's
// i18n API, which picks the browser UI language and falls back to English
// (the manifest's default_locale). Outside an extension context (tests,
// scripts) the key itself is returned.

/** Look up a UI string; `subs` fill `$1`, `$2` … in the message. */
export function t(key: string, subs?: ReadonlyArray<string | number>): string {
  try {
    const api = (globalThis as unknown as { chrome?: typeof chrome }).chrome?.i18n;
    if (api?.getMessage) {
      const msg = api.getMessage(key, subs?.map(String));
      if (msg) return msg;
    }
  } catch {
    /* not in an extension context */
  }
  return key;
}
