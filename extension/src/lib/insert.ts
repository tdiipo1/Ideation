// Insert text into the focused editable element of the active tab.
//
// Uses chrome.scripting with the activeTab grant (given when the user opens
// the extension via its icon or keyboard shortcut) — no broad host
// permissions, no warnings. Best-effort by design: if the page can't be
// reached (chrome:// pages, Web Store, tab navigated since the grant) or
// nothing editable is focused, we return false and the caller falls back to
// the clipboard, which is always populated anyway.

// This function is serialized and executed inside the page, so it must be
// fully self-contained (no imports, no outer-scope references).
function injectText(text: string): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.readOnly || el.disabled) return false;
    // Use the native value setter so frameworks (React etc.) see the change,
    // then fire an input event to run their onChange handlers.
    const proto =
      el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    if (setter) setter.call(el, next);
    else el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const caret = start + text.length;
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* input types like email don't support selection */
    }
    return true;
  }

  if (el.isContentEditable) {
    el.focus();
    return document.execCommand("insertText", false, text);
  }

  return false;
}

export async function insertIntoPage(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return false;

    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: injectText,
        args: [text],
      });
    } catch {
      // allFrames can fail wholesale when cross-origin iframes are present
      // under an activeTab-only grant — retry against the top frame.
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: injectText,
        args: [text],
      });
    }
    return results.some((r) => r.result === true);
  } catch (err) {
    console.warn("[Ideation] Insert into page failed:", err);
    return false;
  }
}
