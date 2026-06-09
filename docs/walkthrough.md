# Walkthrough - SSE Streaming Translation and Enhancements

We have successfully migrated the translation pipeline of the **YouTube Podcast Translator** to use **Server-Sent Events (SSE)** and completed three user-requested enhancements:
1. **Bilingual Title Translation**: Automated fetching of original video title via oEmbed and translating it to prepend the Chinese translation.
2. **GitBook Embedded Player**: Injected the official GitBook `{% embed url="..." %}` block and a direct YouTube fallback link in the published GitBook Markdown file to facilitate listening and reading side-by-side on mobile devices.
3. **Direct GitBook Success Links**: Generated and returned the final GitBook page URL in the publishing API, rendering a clickable shortcut directly in the frontend success banner.

## Detailed Changes

### 1. Backend (`server.js`)
* **Metadata Extraction**: Integrated YouTube oEmbed API inside `/api/transcript` to retrieve the video title dynamically.
* **Title Translator**: Added title translation step to `/api/translate` to build the default formatted title `[Chinese Translation] - Original Title`.
* **Markdown Customization**: Added GitBook's official embed block syntax inside the GitBook publisher instead of raw iframe HTML, which can be sanitized or rendered as plain text by GitBook sync.
* **Link Propagation**: Extracted the final GitBook page slug and returned the complete URL in the publish response payload.

### 2. Frontend (`App.jsx`)
* **Video Title State**: Created state `videoTitle` to store and display the active video title inside the preview pane.
* **Interactive Banners**: Upgraded the GitBook status output to render a link element (`👉 Click to open GitBook Page`) on success.

### 3. Rebuild and Deploy
* Rebuilt using `npm run build:frontend` and restarted with `pm2 restart youtube-podcast-translator --update-env`.

## Technical Notes

### GitBook YouTube Embed

GitBook's Markdown sync supports an official embed block:

```md
{% embed url="https://www.youtube.com/watch?v=VIDEO_ID" %}
```

Use this for published GitBook notes instead of raw `<iframe>` HTML. Raw iframe can be sanitized, rendered as plain text, or behave inconsistently after GitBook sync. The generated note still keeps a normal YouTube link above the embed as a fallback for browsers or mobile contexts where embedded playback is constrained.

### Fast Local Ollama Defaults

The local Ollama path now treats model choice as runtime configuration instead of hard-coding `qwen2.5:14b`.

Default split:

```bash
OLLAMA_TRANSLATE_MODEL=qwen2.5:7b
OLLAMA_TRANSLATE_FALLBACK_MODEL=qwen2.5:14b
OLLAMA_SUMMARY_MODEL=qwen2.5:7b
OLLAMA_SUMMARY_FALLBACK_MODEL=qwen2.5:14b
OLLAMA_SLUG_MODEL=qwen2.5:7b
OLLAMA_SLUG_FALLBACK_MODEL=qwen2.5:14b
```

Reasoning:

- full podcast translation needs better Traditional Chinese stability, so `qwen2.5:7b` is the safer fast default
- summary and slug generation also default to `qwen2.5:7b` because local `qwen3:4b` can stall in non-streaming requests
- `qwen2.5:14b` remains the quality fallback when the fast model fails or the operator explicitly wants higher quality
- `gemma3:4b` and `gemma3n:e4b` are valid candidates for speed experiments, but should be manually checked for Taiwan Mandarin and social-dance terminology quality before becoming defaults
- for interview demos, Gemini 2.5 Flash remains the smoothest path; local Ollama is the offline/privacy/cost-control path

### Microservice Error Semantics

The social publish path now separates demo mock mode from live service mode:

- demo mock mode proxies to `social-post-service` with `mode: "mock"`; the downstream service owns the job lifecycle
- live mode returns `503` when `social-post-service` is unreachable
- live mode also returns `503` when the downstream service is running `MockStrategy`, because a mock strategy is not a real provider integration
- downstream `400/500` errors are propagated instead of being wrapped as fake success

This keeps the demo convenient without lying about distributed-system health or hiding the microservice boundary.

### What Changed From The Earlier Implementation

Before this change, demo mode lived inside `youtube-podcast-translator`:

- `server.js` kept an in-memory `mockJobs` map
- demo publish created a `mock-*` job without calling `social-post-service`
- status polling for mock jobs was simulated by the translator process itself
- this was useful for UI demos, but it was not a real microservice boundary

After this change, the translator is only a proxy:

- demo mode sends `mode: "mock"` to `social-post-service`
- live mode sends `mode: "live"` to `social-post-service`
- `social-post-service` owns job creation, status transitions, and polling results
- live mode fails with `503` when the downstream service is unavailable or only has `MockStrategy`

### Microservice Tradeoffs

Benefits:

- clearer separation between translation/GitBook work and social posting work
- easier to add real posting providers later without changing the translator API surface
- async `202 Accepted + jobId + polling` fits slow provider APIs better than synchronous requests
- failures are observable instead of being hidden behind fake success responses

Costs:

- local demos now require both services to be running
- deployment needs one more process, port, health check, and log stream
- debugging crosses process boundaries, so job IDs and logs matter more
- the current in-memory job store is not durable; production use would need Redis/BullMQ or a database
