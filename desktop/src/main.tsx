import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { I18nProvider, resolveLocale, UI_LANGUAGE_EVENT } from "./i18n";
import "./index.css";

// Holds the UI locale: the `ui_language` setting ("auto" follows the system
// language), updated live when Settings saves a new value.
function Root() {
  const [uiLanguage, setUiLanguage] = useState<string>("auto");

  useEffect(() => {
    invoke<{ ui_language?: string }>("get_settings")
      .then((s) => setUiLanguage(s.ui_language || "auto"))
      .catch(() => {});
    const onChange = (e: Event) => setUiLanguage((e as CustomEvent<string>).detail || "auto");
    window.addEventListener(UI_LANGUAGE_EVENT, onChange);
    return () => window.removeEventListener(UI_LANGUAGE_EVENT, onChange);
  }, []);

  return (
    <I18nProvider locale={resolveLocale(uiLanguage)}>
      <App />
    </I18nProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
