# Implementation Plan - SSE Streaming for Translation

We will transition the translation endpoint `/api/translate` from a single blocking JSON request to a real-time streaming API using Server-Sent Events (SSE). This prevents network connection timeouts (which show up as "AI 翻譯連線中斷，請重試" on the frontend) and allows displaying translation results and progress in real time.

## Proposed Changes

### Backend

#### [MODIFY] [server.js](file:///Users/pac/codes/youtube-podcast-translator/server.js)
- Modify `/api/translate` endpoint to:
  - Set SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`).
  - Translate the chunks sequentially so we can stream each chunk's translation result immediately.
  - Stream the summary of the podcast when it's ready.
  - Stream a `done` event and close the connection when finished.
  - Send an `error` event and close the connection if any error occurs.
  - Add server-side console logs to trace the progress of the translation.

### Frontend

#### [MODIFY] [App.jsx](file:///Users/pac/codes/youtube-podcast-translator/dashboard/src/App.jsx)
- Add a new state `translationProgress` to track the translation percentage (0-100%).
- Update `handleTranslate` to read the streamed response body using a `ReadableStream` reader and decode the SSE events (`data: {...}`).
- Update the UI to:
  - Render a progress bar above the translation button when translating.
  - Show the progress percentage inside the translation button.
  - Render the translated paragraphs dynamically as they arrive.

### Rebuild and Restart

- Run `npm run build:frontend` in `/Users/pac/codes/youtube-podcast-translator` to rebuild the frontend assets into `dashboard/dist`.
- Run `pm2 restart youtube-podcast-translator --update-env` to reload the server.

## Verification Plan

### Manual Verification
- Start the translation process on the dashboard.
- Verify that paragraphs stream in one by one.
- Verify that the progress bar increases steadily.
- Verify that the summary appears when translation completes.
- Verify that no connection timeout error occurs.
