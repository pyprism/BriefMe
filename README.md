# BriefMe [![CI](https://github.com/pyprism/BriefMe/actions/workflows/ci.yml/badge.svg)](https://github.com/pyprism/BriefMe/actions/workflows/ci.yml)

<img src="public/icon/128.png" alt="BriefMe icon" width="64" height="64" align="right">

BriefMe is an open-source browser extension that summarizes the article you are reading using the model provider you choose: a local server such as [Ollama](https://ollama.com), LM Studio or llama.cpp, or a hosted OpenAI-compatible API such as OpenRouter or OpenAI. Click the toolbar button and a summary appears on the page. Page text is sent only to the server you configure.

Works in Chrome, Edge, Brave and other Chromium browsers, Firefox, and Safari (macOS).

## Features

- One click, keyboard shortcut (Alt+Shift+S), or right-click menu: summarize page, selection, or a link without opening it.
- Streams the summary as it is written. Stop, regenerate, copy, or download as Markdown.
- Summary styles: TL;DR, bullet points, detailed, key facts, explain simply, people/numbers/quotes, bias and clickbait check. You can add your own prompts.
- Output in the article language or any language you choose.
- Long articles are split into parts and condensed first, so nothing is silently cut off by the model context.
- Ask follow-up questions about the article.
- Overlay on the page (draggable, resizable) or a side panel (Chrome, Edge, Firefox).
- Local history with search, cached summaries, and a reading-time-saved counter.
- Multi-tab digest: pick open tabs and get one briefing.
- Provider-agnostic: Ollama or any OpenAI-compatible server (LM Studio, llama.cpp, vLLM, OpenRouter, OpenAI), in any combination for primary and backup. The backup is used only if the primary fails. No provider is assumed.
- Optional auto-summarize on sites you list, per-site model overrides, read aloud, send to Obsidian.
- No telemetry, no analytics, no remote code.

## Install

Prebuilt files are attached to each [GitHub release](../../releases):

| Browser | File | How to install |
| --- | --- | --- |
| Chrome, Edge, Brave | `briefme-<version>-chrome.zip` | Unzip, open `chrome://extensions`, enable Developer mode, choose Load unpacked, select the folder. |
| Firefox | `briefme-<version>-firefox.zip` | Open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on, select the zip. |
| Safari (macOS) | `briefme-<version>-safari-macos-unsigned.zip` or the Xcode project zip | See [Safari](#safari). |

Store listings are not published yet.

## Set up a model provider

BriefMe has no built-in provider. On first run, pick one in the setup screen (or enter any URL), add an API key if the provider needs one, press Test connection, then choose a model. You can use a different provider as a backup.

| Provider | Needs | Preset URL |
| --- | --- | --- |
| Ollama | Ollama running, one model pulled | `http://localhost:11434` |
| LM Studio | Local server started, model loaded | `http://localhost:1234/v1` |
| llama.cpp | `llama-server` running | `http://localhost:8080/v1` |
| OpenRouter | API key | `https://openrouter.ai/api/v1` |
| OpenAI | API key | `https://api.openai.com/v1` |
| Other | Any OpenAI-compatible server (vLLM, a proxy, ...) | your URL |

**Ollama only:** Ollama rejects requests from unknown origins, so allow the extension and restart Ollama:

```bash
# macOS (Ollama app)
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*,safari-web-extension://*"
# Linux, Windows and Docker: see the setup page in the extension
```

If Test connection says the server refused the request (403): for Ollama this step is missing; for other providers check the API key.

## Usage

- Click the toolbar button, or press Alt+Shift+S.
- Select text first to summarize only the selection.
- Right-click a link and choose "Summarize link with BriefMe".
- Change style or language in the overlay and the summary regenerates.
- Press Esc to close the overlay.
- All settings, including the primary and backup provider, are in the extension options page and can be changed at any time.


## Build from source

Requires Node 20 or newer and npm.

```bash
npm ci
./build.sh            # typecheck, lint, test, then build Chrome and Firefox
./build.sh --zip      # also create zip files in dist/
./build.sh chrome     # one browser only
```

Output is in `dist/chrome-mv3` and `dist/firefox-mv3`. `build.sh` does not build Safari because that needs Xcode.

Other commands:

```bash
npm run dev            # Chrome with live reload
npm run dev:firefox
npm test               # unit and integration tests
npm run test:e2e       # real Chromium with the extension loaded (npx playwright install chromium first)
npm run typecheck
npm run lint
```

## Safari

Safari extensions must be wrapped in a macOS app, which needs Xcode.

- CI builds an unsigned macOS app and an Xcode project on every release. The unsigned app only loads in Safari after you enable Develop, then Allow Unsigned Extensions.
- To build yourself: `npx wxt build -b safari`, then `xcrun safari-web-extension-converter dist/safari-mv3`, open the project in Xcode, sign it with your own team, and run.
- Safari has no side panel API, so Safari always uses the page overlay.
- The Safari build is produced by the release workflow and has not been tested on a real Safari yet.

## License

[MIT](LICENSE)

## Credits

<a href="https://www.flaticon.com/free-icons/calm" title="calm icons">Calm icons created by Magnific - Flaticon</a>
