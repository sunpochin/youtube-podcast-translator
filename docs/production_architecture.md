# 🎙️ YouTube Podcast Translator 生產架構升級藍圖 (Production Upgrade Blueprint)

本文件詳實記錄當前展示系統的工程設計，坦誠分析與真實生產環境（Production-grade）的技術差距（Gaps），並規劃高可靠度、高容錯性的升級路徑（Upgrade Path），以供技術面試時深入探討系統架構。

---

## 🗺️ 1. 當前展示架構 (Current Demo Architecture)

```
                            ┌────────────────────────┐
                            │      使用者瀏覽器      │
                            └───────────┬────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼ (1. 抓取 / 載入範例)     ▼ (2. SSE 翻譯)            ▼ (3. 社交分享代理)
┌──────────────────────────┐  ┌───────────────────┐  ┌──────────────────────────┐
│   YouTube Scraping       │  │ Promise Mutex     │  │  social-post-service     │
│   (爬蟲 / Sample Fixture)│  │ Queue (Ollama)    │  │  (Mock Job Queue 3012)   │
└──────────────────────────┘  └───────────────────┘  └──────────────────────────┘
```

當前為了方便本地 Demo 與個人使用，系統做出了以下輕量化設計折衷：
1. **單機互斥鎖 (Promise Mutex)**：AI 翻譯模組採用內存 Promise 鏈限制併發，避免 Ollama 壓垮本機 CPU/GPU。
2. **網頁字幕抓取 (DOM Scraping)**：使用 `youtube-transcript` 模擬網頁載入直接提取字幕，免除 API 金鑰配置。
3. **範例字幕降級 (Sample Fixture)**：UI 提供 `Demo Sample Fallback` 快捷鍵，跳過即時抓取，直接載入靜態數據以防 Demo 現場中斷。
4. **內存任務儲存 (In-Memory Jobs)**：微服務 `social-post-service` 的佇列與狀態全數暫存於記憶體 `Map` 中，狀態僅靠時間差轉移。

---

## ⚠️ 2. 已知生產環境差距 (Known Production Gaps)

面試官若深入拷問高併發與高可用性，以下為系統必須坦誠面對的邊界與痛點：

### A. 內存狀態遺失 (State Vulnerability on Crash)
* **問題**：Ollama 佇列、GitOps 互斥鎖與微服務的貼文 Job 均存放於 Node.js 記憶體中。一旦伺服器重啟或因 OOM (Out-of-Memory) 崩潰，所有正在進行的任務會直接消失，且無法跨多個伺服器實例（Horizontal Scaling）共享狀態。
* **評估**：不符合分散式系統的持久化與等冪性（Idempotency）要求。

### B. YouTube 字幕抓取的脆弱性 (Scraper Fragility)
* **問題**：`youtube-transcript` 依賴解析 YouTube 網頁 DOM 結構。YouTube 官方一旦改版或針對伺服器 IP 進行 Rate-limit 限流（回傳 429 Too Many Requests），爬蟲會立即失效。
* **評估**：此為脆弱的「單點故障（Single Point of Failure）」，不具備商業級別的可用性。

### C. Instagram 限時動態發佈的 API 限制 (Meta API Boundaries)
* **問題**：Meta 官方 Instagram Graph API 有嚴格邊界限制：
  1. 官方 API **完全不支援**發佈 Instagram Story 限時動態貼圖（Stickers），包括可點選的「連結貼紙（Link Sticker）」。
  2. 官方 API 僅對商用帳號（Business/Creator Accounts）開放，個人帳號（Personal Accounts）無法通過 OAuth 審查。
* **評估**：任何宣稱能「全自動透過官方 API 幫個人 IG 限動加上點擊連結貼紙」的方案在工程上都是偽命題。

---

## 🚀 3. 生產環境升級路徑 (Production Upgrade Path)

若要將此 PoC (概念驗證) 專案推向真正支援數萬名用戶的生產環境，我們規劃了以下升級路徑：

### 🛠️ 升級 A. 持久化分散式任務佇列 (Durable Queuing)

將 memory-based 佇列升級為由 Redis 驅動的**生產級任務佇列**，實現狀態與計算的完全解耦：

```
使用者請求 ──> Express (Producer) ──> BullMQ (Redis) ──> Workers (Consumer)
                                         │
                                         ▼
                                   PostgreSQL (持久化狀態與日誌)
```

1. **引入 BullMQ (Redis-backed)**：
   * 用於管理 AI 翻譯任務與 GitOps 推送任務。Redis 會將佇列持久化至硬碟，即使伺服器崩潰，任務也能自動復原並由其他 Worker 接手。
2. **數據持久化層 (PostgreSQL)**：
   * 將 Job 的生命週期狀態（`queued` -> `processing` -> `completed` / `failed`）寫入資料庫，前端 Polling 輪詢時直接查詢資料庫，而非查詢微服務的記憶體。

### 🔑 升級 B. 社交授權 Token 自動化維護 (OAuth Token Rotation)

針對真實多平台社群 API 對接，實作安全授權生命週期管理：

1. **Token 兩階段安全存取**：
   * 使用者通過 OAuth 2.0 授權，取得 Instagram **短期存取令牌 (Short-lived Token, 2小時)**。
   * 微服務後端自動向 Meta 交換為 **長期存取令牌 (Long-lived Token, 60天)**。
2. **自動化輪詢刷新 (Cron Refresh Flow)**：
   * 在微服務中建立排程任務（Cron Job），在長期令牌過期前（如第 50 天）自動呼叫 Meta 刷新端點，確保使用者無須重複登入，並使用 **AWS KMS** 加密儲存 Token。
3. **策略模式 (Strategy Pattern)**：
   * 微服務後端保留 `MockStrategy` 用於沙盒測試，並正式接上 `ThreadsStrategy`、`TwitterXStrategy` 與 `InstagramPostStrategy` (發布貼文而非限動) 處理真實對接。

### 🎙️ 升級 C. 多層級降級音訊逐字稿生成管道 (Resilient ASR Pipeline)

徹底防禦 Google 對 YouTube 字幕爬蟲的 IP 封鎖，實作逐級降級容錯（ASR Transcription Pipeline）：

```
[ 貼上 YouTube 連結 ]
       │
       ├──> 1. 讀取並重用已翻譯之資料庫快取 (Cache hit)
       │
       └───[ 發生錯誤 / 未翻譯過 ]
             │
             ├──> 2. 呼叫官方 YouTube Data API 獲取字幕
             │
             └───[ 官方 API 無字幕 / 被拒絕 ]
                   │
                   ├──> 3. 提示使用者手動貼上逐字稿文字
                   │
                   ├──> 4. 允許使用者上傳本地字幕檔 (.srt / .vtt)
                   │
                   ├──> 5. 允許使用者直接上傳 Podcast 音訊檔 (.mp3 / .wav)
                   │
                   └───[ 終極自動化降級 ]
                         │
                         └──> 6. 後端啟動 yt-dlp 僅下載音訊 (搭配 Proxy 池輪詢)
                                │
                                └──> 7. 送入非同步語音識別隊列 (ASR Workers)
                                       │
                                       └──> 呼叫 OpenAI Whisper API 
                                            或部署本地端 GPU Whisper.cpp 叢集
```

這套降級順序確保了系統的**彈性（Resilience）**：系統不保證爬蟲永遠不壞，但保證在任何環節出錯時，都提供工程上的退路（Fallbacks），這才是合格的系統架構師應有的思維。
