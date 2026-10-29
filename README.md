# DevLens

DevLens is a Manifest V3 Chrome extension prototype for collecting browser diagnostics and creating local or opt-in AI-assisted bug reports.

## What it captures

- `console.error` messages (identical messages are grouped with a repeat count), uncaught runtime errors (including source location when available), and unhandled promise rejections after capture starts, including accessible embedded frames
- Failed `fetch` and `XMLHttpRequest` request URLs, methods, statuses, and network error messages (request and response bodies are not collected)
- A compact hierarchy of the last clicked elements (tag, id, role, test id, and class names)
- An explicitly requested screenshot of the current viewport

DevLens does not monitor pages in the background. Select **Start on this page** in the popup to enable capture for the current tab and site; Chrome asks for that site's access the first time. The tab-specific capture session lets DevLens register a document-start reload hook, so startup errors and failed `fetch`/`XMLHttpRequest` requests are recorded after a reload. Other tabs on the same site are not captured. **Alt+Shift+D** starts capture directly after site access has been granted; the first time, use the popup's start button to grant access. Reproduce the issue, then click **Generate report** for a local draft. Capture runs in the page's main world for console and network diagnostics and in an isolated world for uncaught runtime errors. Captured snapshots are held in extension session storage, removed when the tab closes or a new capture is started, and limited to the most recent 50 snapshots per tab. Capture pauses if the tab navigates to another site. Browser-level requests outside page `fetch` and XHR, restricted browser pages, and inaccessible frames are not captured. Errors that occurred before capture is enabled cannot be recovered. The saved PNG combines the webpage screenshot with a clearly labeled DevLens diagnostics panel; Chrome does not allow extensions to screenshot the separate DevTools console window. The local report includes plain-language explanations for common JavaScript errors, along with their technical details. Reports can be copied or downloaded as Markdown; combined screenshots can be saved separately. Local reproduction steps are a template; opt-in AI reports infer steps from the captured evidence and label them for review.

Capture and local reports stay on your device. For free, local AI reports, install [Ollama](https://ollama.com), run `ollama pull qwen2.5:3b`, and select **Ollama (free, local)** in DevLens. The model runs on your computer, with no API key or cloud account required. The first AI request asks for permission to connect to the local Ollama service at `localhost:11434`; only captured diagnostics are sent there, never the screenshot or request bodies.

If Ollama returns HTTP 403, add the exact DevLens origin (`chrome-extension://<extension-id>`) to the user `OLLAMA_ORIGINS` environment variable and restart Ollama. Find the extension ID at `chrome://extensions` → DevLens → **Details**. For example, in PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "chrome-extension://your-extension-id", "User")
```

Allow only the DevLens extension origin; do not use `*`.

OpenAI remains an optional cloud alternative. When selected, DevLens asks for permission to contact `api.openai.com` and sends the same diagnostics. Enter an OpenAI API key for that request; it is used only for authorization and is never saved. The extension requests `activeTab`, `scripting`, and `storage` at install; site and provider host permissions are requested only when needed. Review diagnostics and screenshots for sensitive information before sharing.

## Develop

```powershell
npm install
npm run build
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `dist` directory. After rebuilding, reload the extension from the extensions page.

The extension requests `activeTab`, `scripting`, and `storage` at install. It requests access to an individual site when you select **Start on this page**, then injects capture code at document start on that site. OpenAI and local Ollama access are optional host permissions requested only when you explicitly generate an AI report.
