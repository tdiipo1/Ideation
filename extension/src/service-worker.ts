import { uninstallSurveyUrl } from "./lib/feedback";

// Ask why on uninstall: Chrome opens this page (a prefilled GitHub issue)
// after the extension is removed. Nothing is sent unless the user submits it.
chrome.runtime.setUninstallURL(uninstallSurveyUrl(), () => void chrome.runtime.lastError);

// Open the side panel when the extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "_execute_action") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    return;
  }

  if (command === "toggle-recording") {
    // Make sure the panel is open (opening is allowed here because a command
    // press counts as a user gesture), then ask it to toggle recording.
    // The panel may still be booting after a cold open, so retry briefly
    // until a listener answers.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch {
        /* already open or cannot open on this tab */
      }
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const handled = await chrome.runtime.sendMessage({ type: "toggle-recording" });
        if (handled) return;
      } catch {
        /* no listener yet — panel still loading */
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
});
