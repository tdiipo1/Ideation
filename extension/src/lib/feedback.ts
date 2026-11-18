// Feedback without telemetry. Three hooks, all local:
//
// - a recording counter that unlocks a one-time "rate it" card after a few
//   successful recordings (state lives in chrome.storage.local, or in the
//   panel's localStorage for the Lite edition, which has no storage permission);
// - a Feedback link to a short Google Form (no sign-in needed);
// - the page Chrome opens when the extension is uninstalled (the same form).
//
// Nothing is sent anywhere unless the user clicks a link and submits the page
// it opens. The Chrome Web Store dashboard shows clicks on the rating link as
// page views under the UTM campaign below.

const RATING_AFTER_RECORDINGS = 10;
const STORAGE_KEY = "feedback";

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

// A Google Form that anyone can answer without signing in (a GitHub issue
// link sends signed-out visitors to a login page, so almost nobody answered).
// Its "Version" question is prefilled with the build line and where the
// visitor came from. Responses go to the form owner's Google Forms inbox.
const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSco_jHPDSxgMUF29wpqRX5D3n1NkDb6V9TOhmLxm0sQqQZdfg/viewform";
const FORM_VERSION_ENTRY = "entry.216262963";

function formUrl(source: "feedback" | "uninstall"): string {
  const details = `${buildLine()} · ${source}`;
  const url = `${FORM_URL}?usp=pp_url&${FORM_VERSION_ENTRY}=${encodeURIComponent(details)}`;
  // chrome.runtime.setUninstallURL rejects URLs over 1023 characters.
  if (url.length > 1023) console.warn(`Feedback form URL is ${url.length} chars; Chrome allows 1023`);
  return url;
}

/** Feedback link in the panel footer. */
export function feedbackUrl(): string {
  return formUrl("feedback");
}

/** Page Chrome opens after the extension is uninstalled. */
export function uninstallSurveyUrl(): string {
  return formUrl("uninstall");
}

/** Open a link in a new tab from the side panel. */
export function openInNewTab(url: string): void {
  try {
    chrome.tabs.create({ url });
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
