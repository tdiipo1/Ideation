import { t } from "../lib/i18n";

// Detects whether the user is on macOS so we can render the appropriate
// keyboard shortcut. The manifest binds Alt+I (Win/Linux) and MacCtrl+I (Mac).
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Macintosh/i.test(ua);
}

interface ShortcutHintProps {
  variant?: "compact" | "verbose";
  className?: string;
}

export default function ShortcutHint({ variant = "compact", className = "" }: ShortcutHintProps) {
  const mac = isMac();
  // MacCtrl in Chrome's commands API maps to the physical Control key on Mac.
  // We display ⌃I (Mac control symbol + I) to match Mac conventions.
  const keys = mac ? "⌃I" : "Alt+I";
  const recordKeys = mac ? "⌃R" : "Alt+R";
  const icon = mac ? (
    <svg viewBox="0 0 24 24" className="w-3 h-3 inline-block" fill="currentColor" aria-hidden="true">
      <path d="M22 17.6c-.6 1.4-.9 2-1.7 3.2-1.1 1.7-2.6 3.8-4.5 3.8-1.7 0-2.1-1.1-4.4-1.1-2.3 0-2.8 1.1-4.5 1.1-1.9 0-3.4-1.9-4.4-3.6C-.4 16.6-.7 11.1 1.1 8.1c1.3-2.1 3.3-3.4 5.2-3.4 1.9 0 3.1 1.1 4.7 1.1 1.5 0 2.4-1.1 4.7-1.1 1.7 0 3.4.9 4.7 2.5-4.1 2.3-3.5 8.2 1.6 10.4zM15.5 3.8c.8-1.1 1.5-2.6 1.2-4.1-1.3.1-2.9.9-3.8 2-.8 1-1.5 2.5-1.2 4 1.5.1 3-.8 3.8-1.9z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="w-3 h-3 inline-block" fill="currentColor" aria-hidden="true">
      <path d="M3 5.55C3 4.694 3.673 4 4.5 4h15c.827 0 1.5.694 1.5 1.55v12.9c0 .856-.673 1.55-1.5 1.55h-15c-.827 0-1.5-.694-1.5-1.55V5.55zM4.5 5.5a.05.05 0 00-.05.05v12.9a.05.05 0 00.05.05h15a.05.05 0 00.05-.05V5.55a.05.05 0 00-.05-.05h-15zm6.75 8.25h1.5v3h-1.5v-3zm-3 0h1.5v3h-1.5v-3zm6 0h1.5v3h-1.5v-3zm-6-3h1.5v1.5h-1.5v-1.5zm3 0h1.5v1.5h-1.5v-1.5zm3 0h1.5v1.5h-1.5v-1.5zm-6-3h1.5v1.5h-1.5v-1.5zm3 0h1.5v1.5h-1.5v-1.5zm3 0h1.5v1.5h-1.5v-1.5z" />
    </svg>
  );

  if (variant === "verbose") {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        {icon}
        <span>{t("shortcutVerbose", [keys, recordKeys])}</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {icon}
      <span>{keys}</span>
    </span>
  );
}
