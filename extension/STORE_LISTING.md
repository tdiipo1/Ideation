# Chrome Web Store Listing

Live items:

| Edition | Item | Store URL |
|---|---|---|
| Ideation (Full) | `jhdhkbceipidnhfolikdpmopghgkicjo` | https://chromewebstore.google.com/detail/jhdhkbceipidnhfolikdpmopghgkicjo |
| Ideation Lite | `pmanijfhocbgdafgamjnhdgojennegmm` | https://chromewebstore.google.com/detail/ideation-lite/pmanijfhocbgdafgamjnhdgojennegmm |

The extension **name** and **summary** come from the manifest (`public/_locales/*/messages.json`, keys `extName*` / `extDesc*`) and change only with a new upload. The **description**, screenshots, tiles and links are set in the dashboard per language. When you share a store link, add UTM parameters (`?utm_source=github&utm_medium=readme`): the dashboard's Impressions page breaks page views down by source, medium and campaign.

## Dashboard checklist (one-time, no upload needed)

In the [developer dashboard](https://chrome.google.com/webstore/devconsole/):

1. **Account → Publisher display name.** Set it (for example "Ideation" or your name). Right now the listing shows the account email as the developer.
2. **Store listing → Additional fields.** Homepage URL: `https://github.com/tdiipo1/Ideation`. Support URL: `https://github.com/tdiipo1/Ideation/issues`. Keep the privacy policy URL as is.
3. **Store listing → Description.** Paste the English description below. Then switch the language selector to Español and 中文 (简体) and paste those versions. The Full listing currently shows only two sentences; Lite shows the 0.1 text.
4. **Store listing → Graphic assets.** Upload the five screenshots, the small promo tile and the marquee from `release/store/<edition>/` (see "Assets" below). Remove the old screenshots first.
5. **Category.** Productivity › Tools is fine. Leave it.
6. **Privacy practices.** Nothing changes: no data is collected. Re-certify if the form asks.
7. **Distribution.** All regions, public.

After uploading 0.2.1 (name change), the review takes the usual few days; the description and assets go live immediately once saved and published.

---

## Ideation (Full)

**Name (manifest, 45 chars max):**
- en: `Ideation: Voice to Text & AI Prompts`
- es: `Ideation: Voz a texto y prompts de IA`
- zh_CN: `Ideation：语音转文字与 AI 提示词`

**Summary (manifest description, 132 chars max):**
- en: `Talk, get clean text. Whisper runs in your browser, audio never leaves your device. Cleanup, AI prompt structuring, 99 languages.`
- es: `Habla y obtén texto limpio. Whisper corre en tu navegador: el audio nunca sale de tu equipo. Limpieza, prompts de IA, 99 idiomas.`
- zh_CN: `说话，得到干净的文字。Whisper 在浏览器本地运行，音频不离开你的设备。自动清理、AI 提示词整理、支持 99 种语言。`

### Description — English

```
Ideation turns your spoken thoughts into clean, ready-to-use text. Speech recognition runs inside your browser with OpenAI's Whisper, so your audio never leaves your device. Talk through an idea, a message or a prompt for an AI assistant, then paste the result anywhere.

WHAT YOU CAN DO
• Dictate in any language. The spoken language is detected in the first seconds of each recording, or pin one in Settings. 99 languages with the multilingual models.
• Get clean text, not a raw transcript. Filler words, stutters and Whisper artifacts are removed and capitalization is fixed, with language-aware rules for English, Spanish, Portuguese, French, German, Chinese and Japanese.
• Turn a ramble into a prompt. One click restructures your stream of consciousness into an organized prompt for the AI assistant you use. A free Google Gemini key is included, or bring your own key for Gemini, OpenAI, Anthropic or Groq.
• Smart correction (optional, off by default). An AI model fixes words that were clearly misheard from context, without changing anything else.
• Paste or insert. Every transcript is copied to the clipboard automatically. Insert types it into the text field you were in.
• Keep a history. Browse and re-copy past transcripts. Stored only in your browser.
• See captions while you speak, and the detected language.

HOW IT WORKS
1. Press Alt+I (⌃I on Mac) or click the icon to open the side panel.
2. Press Alt+R (⌃R on Mac) or click the mic and talk.
3. Press again to stop. The cleaned transcript is on your clipboard.
4. Paste it, insert it into the page, or click Structure as Prompt.

WORKS ANYWHERE YOU TYPE
The side panel stays open while you switch tabs, so you can dictate into any web page: chats with AI assistants, email, documents, notes and issue trackers.

PRIVATE BY DESIGN
• Audio is transcribed on your device. No account, no cloud, no subscription.
• No analytics, no telemetry. The extension has no server.
• The only optional network use: the one-time model download from Hugging Face (40 to 590 MB depending on the model), and the text, never audio, that you choose to send to an AI provider for prompt structuring or smart correction.
• Works offline once the model is downloaded.

MODELS
Choose in Settings. Tiny and Base run on any machine; Small gives the best accuracy and uses WebGPU when your browser exposes it.

LOOKING FOR SOMETHING SIMPLER?
Ideation Lite is the same local transcription with no history, settings or AI features, and no network permission beyond the model download.

Interface in English, Spanish and Simplified Chinese. Open source (MIT): github.com/tdiipo1/Ideation
```

### Descripción — Español

```
Ideation convierte lo que dices en texto limpio y listo para usar. El reconocimiento de voz corre dentro de tu navegador con Whisper de OpenAI, así que el audio nunca sale de tu equipo. Habla de una idea, un mensaje o un prompt para un asistente de IA, y pega el resultado donde quieras.

QUÉ PUEDES HACER
• Dictar en cualquier idioma. El idioma se detecta en los primeros segundos de cada grabación, o fíjalo en Ajustes. 99 idiomas con los modelos multilingües.
• Obtener texto limpio, no una transcripción en bruto. Se eliminan muletillas, tartamudeos y artefactos de Whisper, y se corrigen las mayúsculas, con reglas específicas para español, inglés, portugués, francés, alemán, chino y japonés.
• Convertir un monólogo en un prompt. Con un clic, tu flujo de ideas se reorganiza en un prompt ordenado para el asistente de IA que uses. Incluye una clave gratuita de Google Gemini, o usa la tuya de Gemini, OpenAI, Anthropic o Groq.
• Corrección inteligente (opcional, desactivada por defecto). Un modelo de IA corrige palabras claramente mal entendidas según el contexto, sin cambiar nada más.
• Pegar o insertar. Cada transcripción se copia al portapapeles automáticamente. Insertar la escribe en el campo de texto donde estabas.
• Guardar un historial. Consulta y vuelve a copiar transcripciones anteriores. Se guarda solo en tu navegador.
• Ver subtítulos mientras hablas, y el idioma detectado.

CÓMO FUNCIONA
1. Pulsa Alt+I (⌃I en Mac) o haz clic en el icono para abrir el panel lateral.
2. Pulsa Alt+R (⌃R en Mac) o haz clic en el micrófono y habla.
3. Pulsa de nuevo para parar. La transcripción limpia ya está en tu portapapeles.
4. Pégala, insértala en la página o haz clic en Estructurar como prompt.

FUNCIONA DONDE SEA QUE ESCRIBAS
El panel lateral sigue abierto mientras cambias de pestaña, así que puedes dictar en cualquier página web: chats con asistentes de IA, correo, documentos, notas y gestores de tareas.

PRIVADO POR DISEÑO
• El audio se transcribe en tu equipo. Sin cuenta, sin nube, sin suscripción.
• Sin analíticas ni telemetría. La extensión no tiene servidor.
• El único uso de red opcional: la descarga única del modelo desde Hugging Face (de 40 a 590 MB según el modelo) y el texto, nunca el audio, que decidas enviar a un proveedor de IA para estructurar prompts o la corrección inteligente.
• Funciona sin conexión una vez descargado el modelo.

MODELOS
Elige en Ajustes. Tiny y Base funcionan en cualquier equipo; Small ofrece la mejor precisión y usa WebGPU cuando tu navegador lo expone.

¿BUSCAS ALGO MÁS SIMPLE?
Ideation Lite es la misma transcripción local sin historial, ajustes ni funciones de IA, y sin más permisos de red que la descarga del modelo.

Interfaz en español, inglés y chino simplificado. Código abierto (MIT): github.com/tdiipo1/Ideation
```

### 说明 — 简体中文

```
Ideation 把你说的话变成干净、可直接使用的文字。语音识别由 OpenAI 的 Whisper 在你的浏览器内完成，音频不会离开你的设备。把一个想法、一条消息或一段给 AI 助手的提示词说出来，然后粘贴到任何地方。

你可以做什么
• 用任何语言口述。每次录音的前几秒自动检测语言，也可以在设置中固定语言。多语言模型支持 99 种语言。
• 得到干净的文字，而不是原始转写。自动去除口头禅、结巴和 Whisper 的常见错误，修正大小写；对中文、英语、西班牙语、葡萄牙语、法语、德语、日语有专门的规则。
• 把一段漫谈整理成提示词。一键把你的思绪流整理成结构清晰的提示词，可用于你使用的任何 AI 助手。内置免费的 Google Gemini 密钥，也可以使用你自己的 Gemini、OpenAI、Anthropic 或 Groq 密钥。
• 智能纠错（可选，默认关闭）。AI 模型根据上下文修正明显听错的词，其他内容保持不变。
• 粘贴或插入。每次转写都会自动复制到剪贴板；「插入」会把文字直接输入到你刚才所在的输入框。
• 保留历史记录。浏览并重新复制以前的转写，只保存在你的浏览器里。
• 说话时实时显示字幕和检测到的语言。

使用方法
1. 按 Alt+I（Mac 上为 ⌃I）或点击图标打开侧边栏。
2. 按 Alt+R（Mac 上为 ⌃R）或点击麦克风，开始说话。
3. 再按一次停止。清理后的文字已在剪贴板中。
4. 粘贴、插入到页面，或点击「整理为提示词」。

在任何输入框都能用
切换标签页时侧边栏保持打开，你可以在任何网页中口述：AI 助手对话、邮件、文档、笔记和任务管理工具。

隐私优先
• 音频在你的设备上转写。无需账号，不用云端，没有订阅。
• 没有分析统计，没有遥测。扩展没有服务器。
• 仅有的可选网络访问：首次从 Hugging Face 下载模型（按模型 40 到 590 MB），以及你主动选择发送给 AI 服务商用于整理提示词或智能纠错的文字（绝不发送音频）。
• 模型下载后可离线使用。

模型
在设置中选择。Tiny 和 Base 在任何电脑上都能运行；Small 精度最好，浏览器支持 WebGPU 时会自动使用。

想要更简单的版本？
Ideation Lite 提供同样的本地转写，没有历史记录、设置和 AI 功能，除模型下载外不需要任何网络权限。

界面支持简体中文、英语和西班牙语。开源（MIT）：github.com/tdiipo1/Ideation
```

---

## Ideation Lite

**Name (manifest, 45 chars max):**
- en: `Ideation Lite: Quick Voice to Text`
- es: `Ideation Lite: Voz a texto rápido`
- zh_CN: `Ideation Lite：快速语音转文字`

**Summary (manifest description, 132 chars max):**
- en: `Quick voice typing in any language. Whisper runs in your browser, nothing leaves your device. Record, transcribe, copy. Free.`
- es: `Dictado rápido en cualquier idioma. Whisper corre en tu navegador: nada sale de tu equipo. Graba, transcribe, copia. Gratis.`
- zh_CN: `任何语言的快速语音输入。Whisper 在浏览器本地运行，数据不离开你的设备。录音、转写、复制，完全免费。`

### Description — English

```
Ideation Lite is quick voice typing for your browser. Click the mic, talk, click again: the transcript is on your clipboard. Speech recognition runs inside your browser with OpenAI's Whisper, so your audio never leaves your device.

WHAT YOU GET
• Any language. The spoken language is detected automatically (99 languages with the multilingual model, chosen from your browser language).
• Live captions while you speak, and the detected language.
• Automatic clipboard copy, plus Insert to type the transcript into the field you were in.
• No account, no sign-up, no subscription, no cloud.
• Works offline after a one-time model download (40 to 210 MB).
• A side panel that stays open while you browse other tabs.
• Interface in English, Spanish and Simplified Chinese.

HOW IT WORKS
1. Press Alt+I (⌃I on Mac) or click the icon to open the side panel.
2. Press Alt+R (⌃R on Mac) or click the mic and talk.
3. Press again to stop. The transcript is copied. Paste it anywhere, or click Insert.

PRIVATE BY DESIGN
No analytics, no telemetry, no server. The only network access is the one-time model download from Hugging Face.

WANT MORE?
Ideation (the full edition) adds transcript cleanup, a history, model and language settings, and optional AI prompt structuring and smart correction.

Open source (MIT): github.com/tdiipo1/Ideation
```

### Descripción — Español

```
Ideation Lite es dictado rápido para tu navegador. Haz clic en el micrófono, habla, haz clic de nuevo: la transcripción ya está en tu portapapeles. El reconocimiento de voz corre dentro de tu navegador con Whisper de OpenAI, así que el audio nunca sale de tu equipo.

QUÉ INCLUYE
• Cualquier idioma. El idioma hablado se detecta automáticamente (99 idiomas con el modelo multilingüe, elegido según el idioma de tu navegador).
• Subtítulos en vivo mientras hablas, y el idioma detectado.
• Copia automática al portapapeles, más Insertar para escribir la transcripción en el campo donde estabas.
• Sin cuenta, sin registro, sin suscripción, sin nube.
• Funciona sin conexión tras una descarga única del modelo (de 40 a 210 MB).
• Un panel lateral que sigue abierto mientras navegas por otras pestañas.
• Interfaz en español, inglés y chino simplificado.

CÓMO FUNCIONA
1. Pulsa Alt+I (⌃I en Mac) o haz clic en el icono para abrir el panel lateral.
2. Pulsa Alt+R (⌃R en Mac) o haz clic en el micrófono y habla.
3. Pulsa de nuevo para parar. La transcripción está copiada. Pégala donde quieras o haz clic en Insertar.

PRIVADO POR DISEÑO
Sin analíticas, sin telemetría, sin servidor. El único acceso a la red es la descarga única del modelo desde Hugging Face.

¿QUIERES MÁS?
Ideation (la edición completa) añade limpieza de transcripciones, historial, ajustes de modelo e idioma, y de forma opcional estructuración de prompts con IA y corrección inteligente.

Código abierto (MIT): github.com/tdiipo1/Ideation
```

### 说明 — 简体中文

```
Ideation Lite 是浏览器里的快速语音输入。点击麦克风，说话，再点一下：文字已在剪贴板里。语音识别由 OpenAI 的 Whisper 在你的浏览器内完成，音频不会离开你的设备。

你能得到什么
• 任何语言。自动检测所说的语言（多语言模型支持 99 种语言，按浏览器语言自动选择）。
• 说话时实时显示字幕和检测到的语言。
• 自动复制到剪贴板；「插入」可把文字直接输入到你刚才所在的输入框。
• 无需账号、无需注册、没有订阅、不用云端。
• 首次下载模型（40 到 210 MB）后可离线使用。
• 侧边栏在切换标签页时保持打开。
• 界面支持简体中文、英语和西班牙语。

使用方法
1. 按 Alt+I（Mac 上为 ⌃I）或点击图标打开侧边栏。
2. 按 Alt+R（Mac 上为 ⌃R）或点击麦克风，开始说话。
3. 再按一次停止。文字已复制，粘贴到任何地方，或点击「插入」。

隐私优先
没有分析统计，没有遥测，没有服务器。唯一的网络访问是首次从 Hugging Face 下载模型。

想要更多功能？
完整版 Ideation 增加了文本清理、历史记录、模型和语言设置、可选的 AI 提示词整理和智能纠错。

开源（MIT）：github.com/tdiipo1/Ideation
```

---

## Assets

Generated by `node store-assets/build.mjs` (needs the extension's `node_modules` and a local Chrome or Edge; see the script header). Output in `release/store/full/` and `release/store/lite/`:

| File | Size | Where it goes |
|---|---|---|
| `screenshot-1.png` … `screenshot-5.png` | 1280×800 | Store listing → Screenshots (upload in order) |
| `promo-small.png` | 440×280 | Store listing → Small promo tile |
| `marquee.png` | 1400×560 | Store listing → Marquee promo tile |
| `icon-128.png` | 128×128 | Store icon (same as the manifest icon) |

The scenes are HTML templates in `store-assets/scenes.mjs`; edit the copy there and rerun the script. The folders `release/screenshots*` and `release/* SS` hold the old April 2026 captures and can be deleted. Screenshots use real UI labels from `public/_locales/en/messages.json` and the panel's own colors and layout. The store wants full-bleed images with no padding, square corners, and text that stays readable at half size.

The extension icon (`public/icons`, `public/icons-lite`) is generated by the same script from `store-assets/icon.mjs`.

---

## Build and upload

```bash
cd extension
npm install
npm run build
# Windows PowerShell
Compress-Archive -Path dist-full\* -DestinationPath release\ideation-full-0.2.1.zip -Force
Compress-Archive -Path dist-lite\* -DestinationPath release\ideation-lite-0.2.1.zip -Force
```

Each zip is about 5.5 MB (one ONNX Runtime binary; models are downloaded on first use). The Full build reads the shared Gemini key from `VITE_SHARED_GEMINI_KEY` in `extension/.env`.

In the dashboard open the item → Package → Upload new package, then Submit for review. The version must be higher than the published one.

---

## Review notes for the Chrome Web Store team

**Why `wasm-unsafe-eval` in CSP:**
This extension runs OpenAI's Whisper speech recognition model locally in the browser using ONNX Runtime WebAssembly. The `wasm-unsafe-eval` directive is required to compile and execute the WASM binary for ML inference. No code is fetched from external sources; the WASM binary is bundled with the extension.

**Why `cross_origin_embedder_policy` / `cross_origin_opener_policy`:**
These make the side panel cross-origin isolated so `SharedArrayBuffer` is available and ONNX Runtime can run the model on several WebAssembly threads. Without it transcription runs single-threaded and is several times slower on machines without WebGPU.

**Why `host_permissions` for huggingface.co (and *.hf.co):**
The Whisper model weights (40 to 600 MB depending on the chosen model) are downloaded from Hugging Face on first use and cached in the browser's Cache Storage. This is a one-time download. After caching, the extension works offline.

**Why `unlimitedStorage`:**
The cached model weights can exceed the default storage quota; without this permission the browser may evict them and force a re-download.

**Why `clipboardWrite`:**
The transcript is copied to the clipboard automatically after each recording (the product's core action).

**Why `scripting` and `activeTab`:**
The optional "Insert" button types the transcript into the text field the user has focused on the current tab. The script runs only when the user clicks Insert (or has enabled auto-insert), only on the active tab, and only writes the transcript text.

**Why `storage` (Full edition only):**
Settings and the transcript history are stored locally in `chrome.storage.local`.

**Why `host_permissions` for API providers (Full edition only):**
The prompt structuring and optional smart correction features send the transcript *text* to the AI provider the user selected (Google Gemini, OpenAI, Anthropic, or Groq). Smart correction is off by default and labeled as sending text. No user data is collected or stored by the extension developer.
