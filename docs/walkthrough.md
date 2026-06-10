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

#### 中文
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

#### English
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

### `gemma3:4b` A/B, 用白話講

#### 中文
我們把 `gemma3:4b` 放進同一條翻譯流程做比較，不是只看它「有沒有回話」，而是看它在完整工作流裡表現如何。

流程很簡單：

1. 給 `qwen2.5:7b` 和 `gemma3:4b` 同一份英文字幕
2. 讓它們吃同一份 prompt，不改題目
3. 讓它們都經過同一個 `normalizeTraditionalChineseOutput`
4. 比較輸出是不是自然、術語有沒有翻錯、簡體字有沒有漏進來

小朋友版比喻：

- `prompt` 就像同一份考卷
- `normalization` 就像交卷前的最後擦拭
- `A/B` 就是兩個同學答同一份題，老師用同一把尺改分數

我們這樣做，是因為翻譯模型不能只看「快不快」。  
如果它很快，但把 `Salsa` 翻錯、把 `socials` 翻得不自然，或者混進簡體字，這就不是可用的預設模型。

#### English
We compare `gemma3:4b` inside the same translation pipeline, so we are not just checking whether it answers. We are checking how it behaves across the full workflow.

The steps are simple:

1. Give `qwen2.5:7b` and `gemma3:4b` the same English subtitle segment
2. Feed them the same prompt without changing the task
3. Run both outputs through the same `normalizeTraditionalChineseOutput`
4. Compare whether the output sounds natural, whether domain terms stay correct, and whether simplified Chinese slips in

Kid-friendly version:

- `prompt` is the same exam paper
- `normalization` is the final wipe before handing in the paper
- `A/B` means two students answer the same paper, and the teacher grades them with the same ruler

We do it this way because a translation model is not judged only by speed. If it is fast but mistranslates `Salsa`, makes `socials` sound unnatural, or leaks simplified Chinese, then it is not a usable default model.

### Benchmark 標準在哪裡

#### 中文
這次 benchmark 的標準主要分三層：

1. 實際執行規則寫在 [scripts/benchmark_ollama_models.js](/Users/pac/codes/interview/youtube-podcast-translator/scripts/benchmark_ollama_models.js)
2. 翻譯後的繁中整理規則寫在 [src/services/ai.service.js](/Users/pac/codes/interview/youtube-podcast-translator/src/services/ai.service.js)
3. 為什麼要這樣比，寫在這份文件和 [README.md](/Users/pac/codes/interview/youtube-podcast-translator/README.md)

小朋友版理解：

- `scripts/benchmark_ollama_models.js` 是「考卷和計分器」
- `ai.service.js` 是「改字和整理答案的老師」
- `README` 和 `walkthrough` 是「這次考試規則的說明書」

如果你下次想找，只要先看這三個地方就夠了。

#### English
The benchmark rules are split into three layers:

1. The actual execution logic lives in [scripts/benchmark_ollama_models.js](/Users/pac/codes/interview/youtube-podcast-translator/scripts/benchmark_ollama_models.js)
2. The Traditional Chinese cleanup rules live in [src/services/ai.service.js](/Users/pac/codes/interview/youtube-podcast-translator/src/services/ai.service.js)
3. The reasoning for the comparison lives in this file and in [README.md](/Users/pac/codes/interview/youtube-podcast-translator/README.md)

Kid-friendly version:

- `scripts/benchmark_ollama_models.js` is the exam paper and the scoring machine
- `ai.service.js` is the teacher who fixes wording and cleans up answers
- `README` and `walkthrough` are the rulebook for this exam

If you need to find it again later, those are the first three places to check.

### 第二層是什麼

#### 中文
第二層不是再問模型一次，而是模型回來後，程式再做摘要專用清理。

它的工作內容很直接：

1. 先跑 `normalizeTraditionalChineseOutput`
2. 再跑摘要專用的 `normalizeSummaryOutput`
3. 切掉常見開場白，例如「好的，以下是」
4. 去掉標題符號、粗體符號、項目符號
5. 主流程 `/api/translate` 的 Gemini 摘要也接同一套清理
6. 摘要專用詞表會把殘留英文詞換回中文，例如 `migrants`、`socials`、`lineup`

小朋友版理解：

- 第一層是在考前提醒模型不要亂講
- 第二層是在交卷後，把多出來的包裝紙撕掉

這樣做是因為摘要模型常常不是完全不會答，而是會多送一層前言。  
只靠 prompt 不夠，所以要多一層程式保險。

#### English
The second layer is not another model call. It is a summary-specific cleanup step after the model already returns text.

Its job is straightforward:

1. Run `normalizeTraditionalChineseOutput` first
2. Then run the summary-specific `normalizeSummaryOutput`
3. Remove common openers such as "好的，以下是"
4. Strip title markers, bold markers, and bullet markers

Kid-friendly version:

- The first layer reminds the model not to ramble
- The second layer tears off the extra wrapping paper after the answer comes back

The reason is simple: summary models often do answer correctly, but they add an extra preface.  
Prompting alone is not enough, so we add a code-side safety layer.

### Benchmark 結果摘要

#### 中文
目前這輪 benchmark 的結論很簡單：

- `qwen2.5:7b` 仍然是最穩的 fast default
- `qwen2.5:14b` 保留當品質 fallback
- `gemma3:4b` 是快，但還不夠穩到能直接取代預設
- `llama3.1:8b` 可用，但沒有明顯贏過 `qwen2.5:7b`
- `phi3:mini` 和 `deepseek-r1:7b` 不適合這條繁中社交舞翻譯路徑

小朋友版理解：

- `qwen2.5:7b` 像是跑得快又不太會跌倒的選手
- `qwen2.5:14b` 像是比較慢、但可以救場的後備選手
- `gemma3:4b` 像是跑很快的人，但還在學怎麼不要踩線

#### English
The current benchmark conclusion is straightforward:

- `qwen2.5:7b` is still the most stable fast default
- `qwen2.5:14b` stays as the quality fallback
- `gemma3:4b` is fast, but not stable enough to replace the default yet
- `llama3.1:8b` is usable, but it does not clearly beat `qwen2.5:7b`
- `phi3:mini` and `deepseek-r1:7b` are not a good fit for this Traditional Chinese social-dance translation path

Kid-friendly version:

- `qwen2.5:7b` is the runner who is fast and does not fall over often
- `qwen2.5:14b` is the slower backup runner who can save the day
- `gemma3:4b` is fast, but still learning not to step outside the line

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

### skill 和 Claude Code skill 是一樣嗎

#### 中文
不是同一種東西。這個專案裡的 `skill.md` 比較像工作流程說明書，內容告訴你：

- 什麼情況該用這個流程
- 先看哪個檔案
- 發佈時要注意什麼規則

真正會執行的判斷，還是放在 `.js` 檔裡。

`Claude Code skill` 是 Claude Code 平台自己的技能包格式，兩者概念相近，但不是同一套規格。  
你可以把它們想成：

- `skill.md` = 流程筆記
- `.js` = 實際機器

#### English
They are not the same thing. In this project, `skill.md` is closer to a workflow handbook:

- when to use the flow
- which file to inspect first
- what rules matter during publishing

The actual executable logic still lives in `.js` files.

`Claude Code skill` is a Claude Code platform skill format. The ideas are similar, but they are not the same spec.  
You can think of them like this:

- `skill.md` = workflow notes
- `.js` = the actual machine
