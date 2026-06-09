# 🎙️ YouTube Podcast Translator

[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen.svg)](#)
[![Unit Tests](https://img.shields.io/badge/Unit%20Tests-20%20Passed-brightgreen.svg)](#)
[![Coverage (Core)](https://img.shields.io/badge/Coverage%20(Core)-100%25-brightgreen.svg)](#)
[![Overall Coverage](https://img.shields.io/badge/Coverage%20(Overall)-61.22%25-brightgreen.svg)](#)

這是一個專門為了快速抓取 YouTube 影片英文字幕，並呼叫免費的 Gemini 2.5 Flash API / 本地 Ollama 進行中英雙語對照翻譯與核心摘要的單頁 Web 工具。

---

## 🎯 面試亮點與系統設計 (Engineering Highlights & Interview Pitch)

本專案不僅是一個翻譯工具，更針對常見的系統工程與資源限制設計了強固的防禦性方案。**詳細的面試折衷與設計決策說明請參閱 [面試深度解析指南](docs/interview_guide.md)。**

*   **⚡ 即時串流響應 (SSE)**：採用 **Server-Sent Events** 實作秒級首字翻譯推送，並在連線中斷時主動中斷後續 AI 請求，避免 API 額度與運算資源浪費。
*   **🔒 本地 model 互斥排隊鎖 (Mutex Queue)**：為防止多併發 LLM 推理榨乾本地 Mac Mini 的 GPU 記憶體，採用 Promise Chain 實作互斥隊列鎖與超時控制（AbortSignal），對密集運算進行資源負載限制。
*   **🛠️ GitOps 完整性防護**：同步 GitBook 目錄時，在寫入前自動執行 `git fetch && git reset --hard` 同步，並搭配自動生成印章（Signature Marker）與 `isLocalRequest` 來源判定，**絕對不覆蓋手寫筆記**。
*   **🧩 SOLID 乾淨架構重構**：原單體服務已解耦為模組化的 Auth 中間件、AI 服務、GitBook 同步器與純函數 Helper 工具，讓單元測試與覆蓋率更容易擴展。

---

## 🌐 史詩級微服務架構整合 (Companion Microservice Integration)

本系統與鄰近的 **`social-post-service`**（社交發佈微服務）進行了深度整合，展示了現代分佈式系統中「關注點分離」與「非同步容錯（Resilient Asynchronous Queue）」的設計範式。

### 📌 系統架構與資料流 (Architecture & Data Flow)

```
                       [ 瀏覽器前端 ]
                             │
            ┌────────────────┴────────────────┐
            ▼ (1. 渲染 9:16 Canvas 卡片)        ▼ (2. 呼叫發佈代理)
      [ Canvas 卡片引擎 ]                POST /api/social/publish
     (含跨域安全 QR Code)                     │
                                             ▼
                               ┌──────────────────────────┐
                               │  youtube-translator 後端  │
                               │      (主服務: 3015)       │
                               └─────────────┬────────────┘
                                             │ (3. Proxy & Timeout 5s)
                                             ▼
                               ┌──────────────────────────┐
                               │    social-post-service   │
                               │      (微服務: 3012)       │
                               └─────────────┬────────────┘
                                             │ (4. 立即回傳 202 Accepted)
                                             ▼
                                 [ 任務排隊隊列 (Job Queue) ] ──┐
                                             │                  │ (5. 異步執行)
                                             ▼                  ▼
                                     (模擬發佈/實體 API)    [ 狀態轉移 ]
                                     (MockStrategy / SDK)   Pending -> Completed
```

### 💎 微服務整合設計與面試亮點：

1. **關注點分離 (Separation of Concerns)**：
   * **主服務 (youtube-podcast-translator)**：專注於 CPU/IO 密集的音訊抓取、串流翻譯、GitBook 同步與 Canvas 視覺合成。
   * **微服務 (social-post-service)**：專注於非同步發文任務的佇列管理與多平台社群（如 Instagram）發佈邏輯的解耦。

2. **非同步任務與輪詢模式 (Async Polling Pattern)**：
   * 社交平台發佈涉及高延遲的圖片上傳與 API 互動，主服務後端代理轉發時，微服務**立刻回傳 `202 Accepted` 與 `jobId`**。
   * 主服務前端取得 `jobId` 後，自動啟動**狀態輪詢器 (Polling)**（每 1.5 秒請求 `/api/social/status/:jobId`），動態追蹤任務狀態（`queued` -> `posting` -> `completed`/`failed`），提供極佳的非同步狀態追蹤體驗。

3. **明確的錯誤語意與 Demo 模式 (Error Semantics & Demo Mode Toggle)**：
   * 系統拒絕將真正的連線失敗偽裝成成功。當切換為**實體微服務 (Live)** 模式時，若微服務斷線，系統將明確回傳 `503 Service Unavailable` 並引導使用者檢查微服務狀態。
   * 為了方便 Demo 展示，系統提供**模擬展示 (Demo Mock)** 模式，但模擬任務仍由 `social-post-service` 建立與追蹤；主服務不再用本地記憶體偽造 job lifecycle。若微服務未啟動，Demo 與 Live 都會明確失敗。
   * **Live 模式不允許落回 MockStrategy**：如果下游仍以 `STRATEGY=mock` 執行，`social-post-service` 會回傳 `503`，避免把 demo mock 包裝成真實 Instagram 發佈。

---

### 📝 非同步任務日誌範例解析 (Real-World Async Job Output)

以下為本系統在實際運行中，微服務處理完成後回傳的典型 JSON 數據結構。這也是面試時向架構師展示系統可觀測性（Observability）與非同步狀態追蹤設計的絕佳範本：

```json
{
  "jobId": "3636ad0c-b005-4511-a805-f213ee7d6d40",
  "status": "completed",
  "caption": "🎙️ 我剛翻譯了一篇雙人社交舞 Podcast 筆記！\n\n標題：每周一句小劇場 【0602】 - 每週一句小劇場 【0602】\n閱讀全文對照：https://sunpochin.gitbook.io",
  "platforms": ["instagram"],
  "results": [
    {
      "platform": "instagram",
      "success": true,
      "platformPostId": "mock_instagram_1781012089505_7rennq",
      "simulatedDelay": 1322
    }
  ],
  "createdAt": "2026-06-09T13:34:48.179Z",
  "updatedAt": "2026-06-09T13:34:49.508Z"
}
```

#### 📊 欄位設計深意：
* `jobId`：UUID v4 規格，用於追蹤整個分散式交易的生命週期，便於日誌追蹤（Distributed Tracing）。
* `status`：狀態機指標。包含 `pending`（排隊中）、`processing`（發佈中）、`completed`（發佈成功）與 `failed`（發佈失敗）。
* `results[].simulatedDelay`：由微服務內部的排程器依據外部限流（Rate-Limit）動態計算出的防禦性延遲時間（毫秒），模擬真實人類操作以避免 API 被判定為機器人而封鎖。
* `platformPostId`：平台回傳的真實貼文識別碼（此處為 Mock 測試代號），用以支援後續的「貼文狀態追蹤」或「刪除/修改貼文」功能。

---

## 🚀 快速開始

1.  **環境配置**：
    確保環境變數中含有 `GEMINI_API_KEY`（若需使用 Gemini 模式）：
    ```bash
    export GEMINI_API_KEY="您的_GEMINI_API_KEY"
    ```

2.  **安裝與建置**：
    在專案根目錄下執行：
    ```bash
    # 使用 npm 安裝所有相依性
    npm run install:all
    # 建置 React 前端靜態頁面
    npm run build:frontend
    ```

3.  **啟動伺服器**：
    ```bash
    npm start
    ```

4.  **瀏覽使用**：
    打開瀏覽器存取：`http://localhost:3015`

---

## 🛠️ 技術架構

*   **前端**：Vite + React 19 + Tailwind CSS + Lucide React 圖標。
    *   **`/dashboard`** 目錄：包含響應式雙欄閱讀器、影片 Embedded 預覽、Markdown 筆記一鍵匯出，以及 **9:16 IG Story 卡片渲染器（自動生成指向 GitBook 網址的跨域安全 QR Code，並支持一鍵下載美圖與遞交微服務）**。
*   **後端**：Express + `youtube-transcript` (秒級抓取英文字幕) + `@google/genai` (調用免費的 Gemini 2.5 Flash) / 本地 Ollama (預設快速模型：`qwen2.5:7b`，品質 fallback：`qwen2.5:14b`) + `social-post-service` 代理發佈路由。

### 本地 Ollama 模型調校

本地模式已改成以速度優先的預設值，避免 `qwen2.5:14b` 在 Mac Mini 上拖慢整段 Podcast 翻譯。可用環境變數依任務調整模型：

```bash
export OLLAMA_TRANSLATE_MODEL=qwen2.5:7b
export OLLAMA_TRANSLATE_FALLBACK_MODEL=qwen2.5:14b
export OLLAMA_SUMMARY_MODEL=qwen2.5:7b
export OLLAMA_SUMMARY_FALLBACK_MODEL=qwen2.5:14b
export OLLAMA_SLUG_MODEL=qwen2.5:7b
export OLLAMA_SLUG_FALLBACK_MODEL=qwen2.5:14b
```

建議面試 demo 仍優先使用 Gemini 2.5 Flash；本地 Ollama 模式定位為離線、隱私與成本控制路徑。`qwen3:4b` 在本機非串流測試中可能長時間無回應，不適合目前的 API hot path。若要追求更快回應，可另行實測 `gemma3:4b` 或 `gemma3n:e4b`，但繁中翻譯與舞蹈術語品質需要人工抽查。

---

## 🧪 測試與覆蓋率 (Testing & Coverage)

專案包含完整的單元測試與 E2E 測試，採用 Node.js 原生測試框架，並透過 **Node.js Native Mock 模組** 隔離了外部 AI 與 Git 執行指令，實現 **100% 離線測試與高覆蓋率**：

1.  **執行單元與 Mock 整合測試**：
    ```bash
    npm run test
    ```
2.  **生成覆蓋率報告**：
    ```bash
    npm run test:coverage
    ```
    *   **`helpers.js`**：**100% 覆蓋**
    *   **`auth.js`**：**91.11% 覆蓋**
    *   **`ai.service.js`**：**83.43% 覆蓋**
    *   **`gitbook.service.js`**：**71.61% 覆蓋**
    *   **`overall`**：**61.22% 覆蓋**
3.  **執行端到端 (E2E) 測試**：
    ```bash
    node toolbox/test_e2e_video.js
    ```
