---
name: integration-tester
description: >-
  工作流：驗證 youtube-podcast-translator 本地微服務與 AI 翻譯整合之測試流程，包括 PM2 狀態檢查、社交微服務發佈測試與 Ollama 本地模型效能檢測。
---

# Integration Tester Skill

## Overview
此 Skill 用於規範 youtube-podcast-translator 專案在修改後的「系統整合測試」與「微服務架構成熟度驗證」流程。能指引 Agent 如何啟動/重啟 PM2 服務、執行非同步發佈測試，以及驗證本地 Ollama 翻譯服務。

## Quick Start
當系統發生變更，或使用者要求「驗證整合測試」、「檢查服務狀態」時，Agent 必須遵循以下步驟：
1. **重啟服務**：使用 PM2 重啟所有微服務，確保載入最新環境變數。
2. **驗證微服務整合**：執行本地社交微服務整合測試腳本。
3. **驗證本地 AI 翻譯管道**：打一個本地 Mock API 請求以確認翻譯耗時與字詞安全過濾。

---

## 整合驗證流程 (Workflow Steps)

### 1. PM2 服務重啟與檢查
當環境變數（如 `.env`）修改或代碼重構後，必須重啟 PM2 process 並確認狀態：
```bash
# 重啟並更新環境變數
pm2 restart all --update-env

# 查看目前線上的 process 狀態
pm2 list
```
*主要服務清單：*
- `youtube-podcast-translator` (埠號: 3015)
- `social-post-service` (埠號: 3012)

### 2. 社交發佈微服務整合測試
執行專案內建的非同步任務測試腳本，驗證 Mock 與 Live 模式的回應機制：
```bash
node scripts/verify_social_integration.js
```
*驗證成功指標：*
- **Mock 模式**：發送發佈請求後，回傳 `202 Accepted`，且輪詢狀態應正確經歷 `queued` -> `posting` -> `completed` 的轉換。
- **Live 模式**：如果實體微服務 (social-post-service) 關閉，Live 模式必須正確回傳 `503 Service Unavailable`（嚴格禁止偽裝成成功）。

### 3. 本地 Ollama 翻譯與品質快篩
執行一個簡單的本地翻譯 API 測試，檢驗翻譯耗時（Wall time）以及「莎莎舞 (Salsa)」字詞過濾是否生效：
```bash
node -e '(async()=>{
  const payload = {
    videoId: "integration-test",
    title: "Salsa is a living culture",
    mode: "ollama",
    transcript: [{ text: "Salsa is a living culture.", start: 0, duration: 5 }]
  };
  const t = Date.now();
  const r = await fetch("http://127.0.0.1:3015/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  console.log(JSON.stringify({
    status: r.status,
    time_ms: Date.now() - t,
    preview: text.replace(/\s+/g, " ").slice(0, 400)
  }));
})();'
```
*檢查要點：*
- 生成的中文必須包含「**莎莎舞**」，不得出現「桑巴舞」、「沙薩」或簡體字殘留。
- 單句端到端耗時應在 **15-30 秒內**（溫啟動）完成。
