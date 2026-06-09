# 🎙️ YouTube Podcast Translator

[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen.svg)](#)
[![Unit Tests](https://img.shields.io/badge/Unit%20Tests-6%20Passed-brightgreen.svg)](#)
[![Coverage (Core)](https://img.shields.io/badge/Coverage%20(Core)-100%25-brightgreen.svg)](#)

這是一個專門為了快速抓取 YouTube 影片英文字幕，並呼叫免費的 Gemini 2.5 Flash API / 本地 Ollama 進行中英雙語對照翻譯與核心摘要的單頁 Web 工具。

---

## 🎯 面試亮點與系統設計 (Engineering Highlights & Interview Pitch)

本專案不僅是一個翻譯工具，更針對常見的系統工程與資源限制設計了強固的防禦性方案。**詳細的面試折衷與設計決策說明請參閱 [面試深度解析指南](docs/interview_guide.md)。**

*   **⚡ 即時串流響應 (SSE)**：採用 **Server-Sent Events** 實作秒級首字翻譯推送，並在連線中斷（如關閉網頁）時主動中斷後續 AI 請求，避免 API 額度與資源浪費。
*   **🔒 本地 model 互斥排隊鎖 (Mutex Queue)**：為防止多併發 LLM 推理榨乾本地 Mac Mini/筆電的 GPU 記憶體，採用 Promise Chain 實作互斥隊列鎖，對密集運算進行資源負載限制。
*   **🛠️ GitOps 完整性防護**：同步 GitBook 目錄時，在寫入前自動執行 `git fetch && git reset --hard` 同步，並搭配自動生成印章（Signature Marker）與 `isLocalRequest` 來源判定，**絕對不覆蓋手寫筆記**。
*   **🧩 SOLID 乾淨架構重構**：原單體服務已解耦為模組化的 Auth 中間件、AI 服務、GitBook 同步器與純函數 Helper 工具，讓單元測試與覆蓋率更容易擴展。

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
    *   **`/dashboard`** 目錄：包含響應式雙欄閱讀器、影片 Embedded 預覽及 Markdown 筆記一鍵匯出功能。
*   **後端**：Express + `youtube-transcript` (秒級抓取英文字幕) + `@google/genai` (調用免費的 Gemini 2.5 Flash) / 本地 Ollama (預設 Qwen 2.5 14b)。

---

## 🧪 測試與覆蓋率 (Testing & Coverage)

專案包含完整的單元測試與 E2E 測試，採用 Node.js 原生測試框架，無額外依賴：

1.  **執行單元測試**：
    ```bash
    npm run test
    ```
2.  **生成覆蓋率報告**：
    ```bash
    npm run test:coverage
    ```
3.  **執行端到端 (E2E) 測試**：
    ```bash
    node toolbox/test_e2e_video.js
    ```
