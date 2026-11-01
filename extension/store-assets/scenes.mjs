// Store screenshot and promo-tile scenes, as self-contained HTML pages.
//
// The side panel is reproduced from the real components (TranscriptBox,
// MicButton, AppFull/AppLite) with the same Tailwind colors, sizes and labels,
// filled with realistic content so each screenshot shows one feature. Edit
// the copy here and rerun `node store-assets/build.mjs`.

import { iconDataUri, BRAND } from "./icon.mjs";

const THEME = {
  full: {
    bg: "linear-gradient(135deg,#070f24 0%,#0c2461 55%,#1d4ed8 100%)",
    glow: "rgba(96,165,250,.38)",
    a400: "#60a5fa",
    a500: "#3b82f6",
    a600: "#2563eb",
    shadow: "rgba(59,130,246,.35)",
  },
  lite: {
    bg: "linear-gradient(135deg,#1a0a02 0%,#6b2a07 55%,#ea580c 100%)",
    glow: "rgba(251,146,60,.38)",
    a400: "#fb923c",
    a500: "#f97316",
    a600: "#ea580c",
    shadow: "rgba(249,115,22,.35)",
  },
};

const FONT =
  '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';

// ---------------------------------------------------------------- icons ----

const MIC_SVG = `<svg width="32" height="32" viewBox="0 0 24 24" fill="#fff"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
const STOP_SVG = `<svg width="32" height="32" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
const KEYBOARD_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M3 5.55C3 4.694 3.673 4 4.5 4h15c.827 0 1.5.694 1.5 1.55v12.9c0 .856-.673 1.55-1.5 1.55h-15c-.827 0-1.5-.694-1.5-1.55V5.55zM4.5 5.5a.05.05 0 00-.05.05v12.9a.05.05 0 00.05.05h15a.05.05 0 00.05-.05V5.55a.05.05 0 00-.05-.05h-15zm6.75 8.25h1.5v3h-1.5v-3zm-3 0h1.5v3h-1.5v-3zm6 0h1.5v3h-1.5v-3zm-6-3h1.5v1.5h-1.5v-1.5zm3 0h1.5v1.5h-1.5v-1.5zm3 0h1.5v1.5h-1.5v-1.5zm-6-3h1.5v1.5h-1.5v-1.5zm3 0h1.5v1.5h-1.5v-1.5zm3 0h1.5v1.5h-1.5v-1.5z"/></svg>`;

// ---------------------------------------------------------------- panel ----

function panelCss(t) {
  return `
.panel{width:380px;height:580px;background:#0f0f0f;color:#f5f5f5;border-radius:14px;border:1px solid rgba(255,255,255,.12);box-shadow:0 40px 90px rgba(0,0,0,.6);padding:16px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;font-size:12px;line-height:1.5;text-align:left}
.p-head{display:flex;align-items:center;justify-content:space-between}
.p-title{font-size:18px;font-weight:700;line-height:28px}
.p-title.lite{font-style:italic;color:#fb923c}
.p-hint{font-size:10px;color:#525252;display:inline-flex;align-items:center;gap:4px}
.p-tabs{display:flex;gap:4px}
.p-tab{font-size:12px;padding:4px 10px;border-radius:4px;color:#737373}
.p-tab.on{background:#262626;color:#fff}
.p-mic{display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 0}
.p-micwrap{position:relative;width:80px;height:80px}
.p-micbtn{position:relative;width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.p-micbtn.idle{background:${t.a500};box-shadow:0 10px 15px -3px ${t.shadow},0 4px 6px -4px ${t.shadow}}
.p-micbtn.rec{background:#ef4444;box-shadow:0 10px 15px -3px rgba(239,68,68,.3)}
.p-ring{position:absolute;inset:0;border-radius:50%;background:rgba(239,68,68,.25);transform:scale(1.32)}
.p-miclabel{font-size:12px;color:#737373}
.p-trans{flex:1;display:flex;flex-direction:column;gap:8px;min-height:0}
.p-row{display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:wrap}
.p-chips{display:flex;gap:4px;align-items:center}
.p-vtab{font-size:10px;padding:2px 8px;border-radius:4px;background:#262626;color:#a3a3a3}
.p-vtab.on{background:#404040;color:#fff}
.p-vtab.prompt{background:#7e22ce;color:#fff}
.p-chip{font-size:10px;padding:2px 6px;border-radius:4px;background:#262626;color:#a3a3a3;white-space:nowrap}
.p-polish{font-size:10px;color:#d8b4fe}
.p-btn{font-size:10px;padding:2px 8px;border-radius:4px;color:#fff}
.p-btn.insert{background:#262626;color:#e5e5e5}
.p-btn.copy{background:${t.a600}}
.p-btn.ok{background:#16a34a}
.p-box{flex:1;background:#171717;border:1px solid #262626;border-radius:8px;padding:12px;font-size:12px;line-height:1.625;white-space:pre-wrap;max-height:256px;min-height:128px;overflow:hidden;box-sizing:border-box}
.p-box.mono{font-size:11px}
.p-structure{font-size:10px;padding:6px 12px;border-radius:4px;background:#9333ea;color:#fff;align-self:flex-start}
.p-live{display:flex;align-items:center;gap:8px;padding:0 4px;font-size:10px;color:#737373}
.p-live .p-chip{margin-left:auto}
.p-bars{display:flex;align-items:flex-end;gap:4px;height:24px}
.p-bars i{display:block;width:4px;border-radius:999px;background:${t.a400}}
.p-caret{display:inline-block;width:2px;height:12px;margin-left:2px;vertical-align:middle;background:#d4d4d4}
.p-pending{color:#a3a3a3}
.p-foot{font-size:10px;color:#404040;text-align:center;margin-top:auto;padding-top:8px;display:flex;justify-content:center;align-items:center;gap:4px}
`;
}

function bars(heights = [40, 70, 100, 55, 35]) {
  return `<span class="p-bars">${heights.map((h) => `<i style="height:${h}%"></i>`).join("")}</span>`;
}

function hint(text) {
  return `<span class="p-hint">${KEYBOARD_SVG}<span>${text}</span></span>`;
}

/**
 * The side panel.
 * state: "recording" | "idle"
 * view: "healed" | "raw" | "prompt"  (idle only)
 */
function panel(edition, o) {
  const lite = edition === "lite";
  const head = `<div class="p-head"><span class="p-title${lite ? " lite" : ""}">${BRAND[edition].name}</span>${hint("Alt+I")}</div>`;
  const tabs = lite
    ? ""
    : `<div class="p-tabs"><span class="p-tab on">Record</span><span class="p-tab">History</span><span class="p-tab">Settings</span></div>`;

  let mic, body;
  if (o.state === "recording") {
    mic = `<div class="p-mic"><div class="p-micwrap"><div class="p-ring"></div><div class="p-micbtn rec">${STOP_SVG}</div></div><span class="p-miclabel">Recording... Click to stop</span></div>`;
    body = `<div class="p-trans">
<div class="p-box">${o.text}<span class="p-pending"> ${o.pending || ""}</span><span class="p-caret"></span></div>
<div class="p-live">${bars()}<span>Listening…</span>${o.lang ? `<span class="p-chip">${o.lang}</span>` : ""}</div>
</div>`;
  } else {
    mic = `<div class="p-mic"><div class="p-micwrap"><div class="p-micbtn idle">${MIC_SVG}</div></div><span class="p-miclabel">Click to record</span></div>`;
    const view = o.view || "healed";
    const viewTabs = lite
      ? ""
      : `<span class="p-vtab${view === "healed" ? " on" : ""}">Healed</span><span class="p-vtab${view === "raw" ? " on" : ""}">Raw</span>${
          o.hasPrompt ? `<span class="p-vtab${view === "prompt" ? " prompt" : ""}">Prompt</span>` : ""
        }`;
    const copyBtn = o.copied
      ? `<span class="p-btn ok">Copied!</span>`
      : `<span class="p-btn copy">Copy</span>`;
    const insertBtn = o.inserted
      ? `<span class="p-btn ok">Inserted!</span>`
      : `<span class="p-btn insert">Insert</span>`;
    body = `<div class="p-trans">
<div class="p-row"><span class="p-chips">${viewTabs}${o.lang ? `<span class="p-chip">${o.lang}</span>` : ""}${o.polishing ? `<span class="p-polish">Polishing with AI…</span>` : ""}</span><span class="p-chips">${insertBtn}${copyBtn}</span></div>
<div class="p-box${view === "prompt" ? " mono" : ""}">${o.text}</div>
${!lite && o.structureButton ? `<span class="p-structure">Structure as Prompt</span>` : ""}
</div>`;
  }
  const foot = `<div class="p-foot">${KEYBOARD_SVG}<span>Alt+I open · Alt+R record</span></div>`;
  return `<div class="panel">${head}${tabs}${mic}${body}${foot}</div>`;
}

// ----------------------------------------------------------------- page ----

function pageCss(t, w, h) {
  return `
*{box-sizing:border-box}
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
body{font-family:${FONT};background:${t.bg};color:#fff;position:relative;-webkit-font-smoothing:antialiased}
.glow{position:absolute;width:1000px;height:1000px;border-radius:50%;background:radial-gradient(closest-side,${t.glow},transparent);right:-300px;top:-350px;pointer-events:none}
.glow2{position:absolute;width:700px;height:700px;border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.07),transparent);left:-250px;bottom:-350px}
.brand{position:absolute;left:72px;top:44px;display:flex;align-items:center;gap:12px;font-weight:700;font-size:18px;letter-spacing:-.01em}
.brand img{width:34px;height:34px;border-radius:9px;box-shadow:0 6px 16px rgba(0,0,0,.35)}
.brand small{font-weight:500;opacity:.6;font-size:15px;margin-left:2px}
.lead{position:absolute;left:72px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center;gap:22px}
.lead h1{font-size:58px;line-height:1.06;font-weight:800;margin:0;letter-spacing:-.025em;text-wrap:balance}
.lead p{font-size:22px;line-height:1.45;margin:0;color:rgba(255,255,255,.8);max-width:520px}
.pills{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.pill{font-size:14px;font-weight:600;padding:7px 14px;border-radius:999px;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(4px)}
.stage{position:absolute;right:88px;top:0;bottom:0;display:flex;align-items:center}
.scaled{width:456px;height:696px}
.scaled .panel{transform:scale(1.2);transform-origin:top left}
.card{background:rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:16px 18px;font-size:15px;line-height:1.6;max-width:520px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.card .label{display:block;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:6px}
.cut{color:#fca5a5;text-decoration:line-through;text-decoration-color:rgba(252,165,165,.75)}
`;
}

function page(edition, w, h, body, extraCss = "") {
  const t = THEME[edition];
  return `<!doctype html><html><head><meta charset="utf-8"><style>${pageCss(t, w, h)}${panelCss(t)}${extraCss}</style></head><body><div class="glow"></div><div class="glow2"></div>${body}</body></html>`;
}

function brand(edition, sub = "") {
  return `<div class="brand"><img src="${iconDataUri(BRAND[edition].color)}" alt="">${BRAND[edition].name}${sub ? `<small>${sub}</small>` : ""}</div>`;
}

// Left-hand headline column. (Named "lead", not "copy": the panel's Copy
// button uses a `copy` class too.)
function copy(h1, p, pills = [], extra = "") {
  return `<div class="lead"><h1>${h1}</h1><p>${p}</p>${
    pills.length ? `<div class="pills">${pills.map((x) => `<span class="pill">${x}</span>`).join("")}</div>` : ""
  }${extra}</div>`;
}

function stage(panelHtml) {
  return `<div class="stage"><div class="scaled">${panelHtml}</div></div>`;
}

// ------------------------------------------------------------- content ----

const LIVE_TEXT =
  "Okay, so the idea is a voice tool that lives in the browser. I press a shortcut, talk through whatever I'm thinking, and it hands me clean text I can paste straight into a prompt";
const LIVE_PENDING = "without retyping any";

const RAW_TEXT =
  `Um, okay so, so the idea is, uh, a voice tool that lives in the browser. I press a shortcut, I I talk through whatever I'm thinking, and it, it hands me clean text, you know, that I can paste straight into a prompt.`;
const RAW_MARKED =
  `<span class="cut">Um,</span> okay so, <span class="cut">so</span> the idea is, <span class="cut">uh,</span> a voice tool that lives in the browser. I press a shortcut, <span class="cut">I</span> I talk through whatever I'm thinking, and <span class="cut">it,</span> it hands me clean text, <span class="cut">you know,</span> that I can paste straight into a prompt.`;
const HEALED_TEXT =
  "Okay, so the idea is a voice tool that lives in the browser. I press a shortcut, talk through whatever I'm thinking, and it hands me clean text that I can paste straight into a prompt.";

const PROMPT_TEXT = `# Build a browser voice-to-text tool

## Goal
A voice tool that lives in the browser and turns speech into clean, paste-ready text.

## Requirements
- Start and stop with a keyboard shortcut
- Transcribe locally; audio never leaves the device
- Remove filler words and fix capitalization
- Copy the result to the clipboard automatically

## Output
A short implementation plan listing the main components.`;

const ES_TEXT =
  "Vale, la idea es una herramienta de voz que vive en el navegador. Pulso un atajo, hablo de lo que estoy pensando y me devuelve un texto limpio que puedo pegar directamente en un prompt.";
const ZH_TEXT =
  "好的，这个想法是一个在浏览器里运行的语音工具。我按一下快捷键，把正在想的事情说出来，它就给我一段干净的文字，可以直接粘贴到提示词里。";
const LITE_TEXT =
  "Can we move the review to Thursday afternoon? I want to walk through the onboarding flow with the whole team before we ship.";

const LANGS = ["Español", "中文", "Português", "Français", "Deutsch", "日本語", "Italiano", "한국어", "Nederlands", "Polski", "Türkçe", "Русский", "العربية", "हिन्दी", "+85 more"];

// ------------------------------------------------------------- privacy ----

function privacyGraphic(t) {
  const card = (icon, title, sub) =>
    `<div class="flow-card"><div class="flow-icon">${icon}</div><div class="flow-title">${title}</div><div class="flow-sub">${sub}</div></div>`;
  const arrow = `<div class="flow-arrow"><svg width="44" height="24" viewBox="0 0 44 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h36M28 3l10 9-10 9"/></svg></div>`;
  const mic = `<svg width="40" height="40" viewBox="0 0 24 24" fill="#fff"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
  const chip = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="#fff" stroke="none"/><path d="M9 2v3M12 2v3M15 2v3M9 19v3M12 19v3M15 19v3M2 9h3M2 12h3M2 15h3M19 9h3M19 12h3M19 15h3"/></svg>`;
  const text = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 11h16M4 16h10"/></svg>`;
  const cloud = `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.1 4.5 4.5 0 0 0 7 18z"/><path d="M3 3l18 18" stroke-width="2.6"/></svg>`;
  return `<div class="flow">
<div class="flow-row">${card(mic, "Your voice", "captured by the mic")}${arrow}${card(chip, "Whisper", "runs in your browser")}${arrow}${card(text, "Clean text", "on your clipboard")}</div>
<div class="flow-no">${cloud}<div><b>No server, no account, no telemetry.</b><span>The only download is the model itself, once. Then it works offline.</span></div></div>
<div class="flow-models"><span>Tiny · 40 MB</span><span>Base · 80 MB</span><span>Small · 250 MB</span><span>WebGPU when available</span></div>
</div>`;
}

const PRIVACY_CSS = `
.lead{width:500px}.lead p{max-width:470px}
.flow{position:absolute;right:72px;top:0;bottom:0;width:600px;display:flex;flex-direction:column;justify-content:center;gap:26px}
.flow-row{display:flex;align-items:center;justify-content:space-between}
.flow-card{width:164px;background:rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:20px 14px 16px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.flow-icon{display:flex;justify-content:center;margin-bottom:10px}
.flow-title{font-size:19px;font-weight:700}
.flow-sub{font-size:13px;opacity:.7;margin-top:2px}
.flow-arrow{display:flex;align-items:center}
.flow-no{display:flex;align-items:center;gap:16px;background:rgba(0,0,0,.3);border:1px dashed rgba(252,165,165,.5);border-radius:14px;padding:14px 18px}
.flow-no b{display:block;font-size:17px}
.flow-no span{font-size:14px;opacity:.75}
.flow-models{display:flex;gap:8px;flex-wrap:wrap}
.flow-models span{font-size:13px;font-weight:600;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18)}
`;

const LANG_CSS = `
.langs{display:flex;flex-wrap:wrap;gap:8px;max-width:520px;margin-top:4px}
.langs span{font-size:15px;padding:5px 12px;border-radius:8px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.14)}
`;

const COMPOSER_CSS = `
.composer{background:#fff;color:#171717;border-radius:14px;padding:14px 16px 12px;font-size:15px;line-height:1.55;max-width:520px;box-shadow:0 24px 60px rgba(0,0,0,.4)}
.composer .to{font-size:12px;color:#737373;border-bottom:1px solid #e5e5e5;padding-bottom:8px;margin-bottom:10px}
.composer .caret{display:inline-block;width:2px;height:16px;background:#171717;vertical-align:-3px;margin-left:1px}
.composer .send{display:inline-block;margin-top:12px;font-size:13px;font-weight:600;padding:6px 14px;border-radius:999px;background:#2563eb;color:#fff}
`;

// -------------------------------------------------------------- scenes ----

export function scenesFor(edition) {
  const t = THEME[edition];
  const S = (name, width, height, html) => ({ name, width, height, html });
  const screenshot = (name, body, css = "") => S(name, 1280, 800, page(edition, 1280, 800, body, css));

  const privacy = screenshot(
    edition === "full" ? "screenshot-4" : "screenshot-3",
    brand(edition) +
      copy(
        "Nothing leaves your device.",
        "Transcription runs locally with OpenAI's Whisper. No account, no cloud, no subscription. Works offline after a one-time model download.",
      ) +
      privacyGraphic(t),
    PRIVACY_CSS,
  );

  const languagesScene = (name, text, lang) =>
    screenshot(
      name,
      brand(edition) +
        copy(
          "99 languages, auto-detected.",
          "The spoken language is detected in the first seconds of a recording and kept for the rest of it. Interface in English, Spanish and Chinese.",
          [],
          `<div class="langs">${LANGS.map((l) => `<span>${l}</span>`).join("")}</div>`,
        ) +
        stage(panel(edition, { state: "idle", text, lang, copied: true, structureButton: edition === "full" })),
      LANG_CSS,
    );

  const promo = S(
    "promo-small",
    440,
    280,
    page(
      edition,
      440,
      280,
      `<div class="tile"><img src="${iconDataUri(BRAND[edition].color)}" alt=""><div><h1>${BRAND[edition].name}</h1><p>${
        edition === "full" ? "Voice to text, locally." : "Quick voice to text."
      }</p><div class="pills">${(edition === "full"
        ? ["No cloud", "Free", "99 languages"]
        : ["No cloud", "Free", "Any language"]
      )
        .map((x) => `<span class="pill">${x}</span>`)
        .join("")}</div></div></div>`,
      `.tile{position:absolute;inset:0;display:flex;align-items:center;gap:26px;padding:0 36px}
.tile img{width:104px;height:104px;border-radius:24px;box-shadow:0 16px 40px rgba(0,0,0,.45);flex:none}
.tile h1{font-size:${edition === "full" ? 40 : 34}px;margin:0;line-height:1.05;letter-spacing:-.02em}
.tile p{font-size:19px;margin:6px 0 0;color:rgba(255,255,255,.82)}
.tile .pills{margin-top:14px;gap:8px}.tile .pill{font-size:12px;padding:5px 11px}`,
    ),
  );

  const marqueeBody =
    brand(edition, edition === "full" ? "Voice to Text & AI Prompts" : "Quick Voice to Text") +
    `<div class="lead mq"><h1>${edition === "full" ? "Talk. Get clean text." : "Talk. Get text."}</h1><p>${
      edition === "full"
        ? "Whisper runs in your browser, so your audio never leaves your device. Clean transcripts, AI prompt structuring, 99 languages."
        : "Click the mic, talk, click again. The transcript is on your clipboard. Whisper runs in your browser, nothing leaves your device."
    }</p><div class="pills"><span class="pill">Runs locally</span><span class="pill">No account</span><span class="pill">Free</span></div></div>` +
    `<div class="stage mq"><div class="scaled mq">${panel(edition, {
      state: "idle",
      text: edition === "full" ? HEALED_TEXT : LITE_TEXT,
      lang: "English",
      copied: true,
      structureButton: edition === "full",
    })}</div></div>`;
  const marquee = S(
    "marquee",
    1400,
    560,
    page(
      edition,
      1400,
      560,
      marqueeBody,
      `.lead.mq{width:640px;gap:18px}.lead.mq h1{font-size:54px}.lead.mq p{font-size:20px;max-width:600px}
.stage.mq{right:80px}.scaled.mq{width:342px;height:522px}.scaled.mq .panel{transform:scale(.9)}`,
    ),
  );

  if (edition === "full") {
    return [
      screenshot(
        "screenshot-1",
        brand(edition, "Voice to Text & AI Prompts") +
          copy(
            "Talk. Get clean text.",
            "Press Alt+R, speak, and paste anywhere. Whisper runs in your browser, so your audio never leaves your device.",
            ["Runs locally", "No account", "Free"],
          ) +
          stage(panel(edition, { state: "recording", text: LIVE_TEXT, pending: LIVE_PENDING, lang: "English" })),
      ),
      screenshot(
        "screenshot-2",
        brand(edition) +
          copy(
            "Ums and stutters, gone.",
            "Filler words, false starts and Whisper artifacts are removed and capitalization is fixed. Switch between Raw and Healed any time.",
            [],
            `<div class="card"><span class="label">Raw</span>${RAW_MARKED}</div>`,
          ) +
          stage(panel(edition, { state: "idle", text: HEALED_TEXT, lang: "English", copied: true, structureButton: true })),
      ),
      screenshot(
        "screenshot-3",
        brand(edition) +
          copy(
            "From ramble to prompt, one click.",
            "Structure as Prompt organizes your stream of consciousness into a prompt for the AI assistant you use. A free Gemini key is included, or bring your own.",
            ["Gemini", "OpenAI", "Anthropic", "Groq"],
          ) +
          stage(panel(edition, { state: "idle", view: "prompt", hasPrompt: true, text: PROMPT_TEXT, lang: "English" })),
      ),
      privacy,
      languagesScene("screenshot-5", ES_TEXT, "Español"),
      promo,
      marquee,
    ];
  }

  return [
    screenshot(
      "screenshot-1",
      brand(edition, "Quick Voice to Text") +
        copy(
          "Quick voice typing. Nothing else.",
          "Click the mic, talk, click again. The transcript is on your clipboard. Whisper runs in your browser, nothing leaves your device.",
          ["Runs locally", "No account", "Free"],
        ) +
        stage(panel(edition, { state: "recording", text: LIVE_TEXT, pending: LIVE_PENDING, lang: "English" })),
    ),
    screenshot(
      "screenshot-2",
      brand(edition) +
        copy(
          "Paste it, or insert it.",
          "Every transcript is copied automatically. Insert types it into the field you were in, on any site.",
          [],
          `<div class="composer"><div class="to">New message · to the team</div>${LITE_TEXT}<span class="caret"></span><br><span class="send">Send</span></div>`,
        ) +
        stage(panel(edition, { state: "idle", text: LITE_TEXT, lang: "English", copied: true, inserted: true })),
      COMPOSER_CSS,
    ),
    privacy,
    languagesScene("screenshot-4", ZH_TEXT, "中文"),
    promo,
    marquee,
  ];
}
