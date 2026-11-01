// Feedback without telemetry. Three hooks, all local:
//
// - a recording counter that unlocks a one-time "rate it" card after a few
//   successful recordings (state lives in chrome.storage.local, or in the
//   panel's localStorage for the Lite edition, which has no storage permission);
// - a Feedback link to a prefilled GitHub issue;
// - the page Chrome opens when the extension is uninstalled (a prefilled
//   GitHub issue with a short checklist).
//
// Nothing is sent anywhere unless the user clicks a link and submits the page
// it opens. The Chrome Web Store dashboard shows clicks on the rating link as
// page views under the UTM campaign below.

const RATING_AFTER_RECORDINGS = 10;
const STORAGE_KEY = "feedback";

export const REPO_URL = "https://github.com/tdiipo1/Ideation";

interface FeedbackState {
  recordings: number;
  /** "pending" until the user rates or dismisses the card. */
  rating: "pending" | "done";
}

const DEFAULT_STATE: FeedbackState = { recordings: 0, rating: "pending" };

export const EDITION_NAME = import.meta.env.VITE_EDITION === "full" ? "Ideation" : "Ideation Lite";

function version(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "";
  }
}

function chromeMajor(): string {
  const m = /Chrome\/(\d+)/.exec(navigator.userAgent);
  return m ? m[1] : "";
}

/** One line identifying the build, appended to prefilled issues. */
function buildLine(): string {
  return `${EDITION_NAME} ${version()} · Chrome ${chromeMajor()}`;
}

// ---- state ----------------------------------------------------------------

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

async function load(): Promise<FeedbackState> {
  try {
    if (hasChromeStorage()) {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      return { ...DEFAULT_STATE, ...(data[STORAGE_KEY] || {}) };
    }
    return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function save(state: FeedbackState): Promise<void> {
  try {
    if (hasChromeStorage()) {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    /* storage unavailable: the counter just doesn't persist */
  }
}

/**
 * Call after each successful recording. Returns true when the rating card
 * should be shown (enough recordings, and the user hasn't answered it yet).
 */
export async function recordingCompleted(): Promise<boolean> {
  const state = await load();
  state.recordings += 1;
  await save(state);
  return state.rating === "pending" && state.recordings >= RATING_AFTER_RECORDINGS;
}

/** The user rated or dismissed the card: never show it again. */
export async function settleRatingNudge(): Promise<void> {
  const state = await load();
  state.rating = "done";
  await save(state);
}

// ---- links ----------------------------------------------------------------

/** The item's reviews page on the Chrome Web Store (tagged so clicks show up in the dashboard). */
export function ratingUrl(): string {
  const campaign = import.meta.env.VITE_EDITION === "full" ? "full" : "lite";
  return `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews?utm_source=extension&utm_medium=rating_card&utm_campaign=${campaign}`;
}

/** Prefilled GitHub issue for general feedback. */
export function feedbackUrl(): string {
  const body = `\n\n---\n${buildLine()}`;
  return `${REPO_URL}/issues/new?labels=feedback&body=${encodeURIComponent(body)}`;
}

/**
 * Page Chrome opens after the extension is uninstalled. A prefilled GitHub
 * issue with a checklist; swap this for a form link (Tally, Google Forms…)
 * if you want answers from people without a GitHub account. Chrome limits
 * the URL to 1023 characters.
 */
export function uninstallSurveyUrl(): string {
  const body = [
    "Sorry to see you go. Why did you uninstall? Tick what applies and submit.",
    "",
    "- [ ] It didn't work on my machine",
    "- [ ] Transcription accuracy",
    "- [ ] Too slow, or the model download",
    "- [ ] I don't need it anymore",
    "- [ ] Privacy or permissions concern",
    "- [ ] Other:",
    "",
    "---",
    buildLine(),
  ].join("\n");
  const url = `${REPO_URL}/issues/new?labels=uninstall&title=${encodeURIComponent("Uninstall feedback")}&body=${encodeURIComponent(body)}`;
  if (url.length > 1023) console.warn(`Uninstall URL is ${url.length} chars; Chrome allows 1023`);
  return url;
}

/** Open a link in a new tab from the side panel. */
export function openInNewTab(url: string): void {
  try {
    chrome.tabs.create({ url });
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
