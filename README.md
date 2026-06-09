# YouTube Podcast Translator 專案說明

這是一個專門為了快速抓取 YouTube 影片英文字幕，並呼叫免費的 Gemini 2.5 Flash API 進行中英雙語對照翻譯與核心摘要的單頁 Web 工具。

## 🚀 快速開始

1. **環境配置**：
   確保環境變數中含有 `GEMINI_API_KEY`：
   ```bash
   export GEMINI_API_KEY="您的_GEMINI_API_KEY"
   ```

2. **安裝與建置**：
   在專案根目錄下執行：
   ```bash
   npm run install:all
   npm run build:frontend
   ```

3. **啟動伺服器**：
   ```bash
   npm start
   ```

4. **瀏覽使用**：
   打開瀏覽器存取：`http://localhost:3015`

## 🛠️ 技術架構

*   **前端**：Vite + React 19 + Tailwind CSS + Lucide React 圖標。
    *   **`/dashboard`** 目錄：包含響應式雙欄閱讀器、影片 Embedded 預覽及 Markdown 筆記一鍵匯出功能。
*   **後端**：Express + `youtube-transcript` (秒級抓取英文字幕) + `@google/genai` (調用免費的 Gemini 2.5 Flash)。
