---
name: podcast-publisher
description: >-
  工作流：將 YouTube Podcast 英文字幕翻譯為繁體中文（符合台灣社交舞與音樂領域術語），並以符合 GitBook 規範的格式發佈，包含產生 Embed 與更新 SUMMARY.md。
---

# Podcast Publisher Skill

## Overview
此 Skill 用於規範並自動化將 YouTube Podcast 字幕翻譯、格式化並發佈至 GitBook 的工作流程。它定義了專業的雙人舞（Salsa/Bachata）術語對齊標準，並提供輔助指令碼以維持 GitBook markdown 格式及目錄樹（`SUMMARY.md`）的結構完整性。

## Dependencies
- 無。本 Skill 為本機獨立工作流。

## Quick Start
當使用者要求「翻譯 Podcast」或「發佈到 GitBook」時，Agent 必須：
1. **翻譯字詞規範**：嚴格使用本文件定義之術語對照表進行翻譯。
2. **特別版權宣告**：如果來源是 **Zouk Nerds Podcast**，必須在文章開頭加入專屬聲明。
3. **使用輔助指令**：呼叫 `publish-helper.js` 來產生檔案與更新目錄。

---

## 翻譯與術語對齊標準

在翻譯 Podcast 內容時，請務必遵守以下繁體中文（台灣習慣用語）術語規範，不得混用簡體字或對岸詞彙：

| 英文原詞 | 台灣社交舞領域常用譯名 | 絕對禁止之譯名 (地雷) |
| :--- | :--- | :--- |
| **Salsa** | Salsa、莎莎舞 | 桑巴舞、沙薩、沙薩舞 |
| **Bachata** | Bachata、巴恰塔 | 芭洽塔、巴西巴恰塔 |
| **Kizomba** | Kizomba | 基宗巴、奇宗巴 |
| **congress / congresses** | 舞蹈節、舞蹈大會 | 國會、議會、代表大會 |
| **social / socials** | 舞會、社交舞會 | 社會、社交的、社交生活 |
| **lineup / lineups** | 師資陣容、演出陣容 | 陣線、隊伍 |
| **festival** | 舞蹈節、藝術節 | 節日、慶典 |
| **workshop / workshops** | 大師課、工作坊 | 車間、研討會 |

### 繁簡與格式校正
- 避免使用簡體殘留字，例如：「里」應改為「裡」；「发」應改為「發」；「体」應改為「體」。
- 當為段落加上時間戳時，格式必須為：`[00:05:23]`，並使用適當的 markdown 標題層級。

---

## GitBook 格式規範

發佈的文章必須具備以下結構：
1. **頂部影片嵌入**：
   使用 GitBook 官方支援的 embed 語法：
   ```markdown
   {% embed url="https://www.youtube.com/watch?v=VIDEO_ID" %}
   ```
2. **特別版權宣告 (Zouk Nerds Podcast 專用)**：
   若內容源自 Zouk Nerds Podcast，必須在影片嵌入下方（大綱上方）加入以下內容：
   ```markdown
   ## Acknowledgement 影音來源
   Special thanks to [Alisson Sandi](https://www.instagram.com/alisson.sandi/), host of the ZoukNerds Podcast, for graciously granting permission for this non-profit translation.
   ZoukNerds: [Video Title](https://www.youtube.com/watch?v=VIDEO_ID)
   ```
3. **摘要大綱**：
   包含核心主旨與 3-4 個關鍵精華看點。
4. **時間戳對照段落**：
   中英文對照。


---

## 輔助指令碼 (Utility Scripts)

本 Skill 提供 `publish-helper.js`，可用於自動產生符合 GitBook 規範的 markdown 檔案並更新 `SUMMARY.md` 目錄。

### 1. 產生 GitBook Markdown 檔案
```bash
node .agents/skills/podcast-publisher/publish-helper.js generate \
  --title "影片中文標題" \
  --slug "video-slug-name" \
  --videoId "VIDEO_ID" \
  --summaryPath "path/to/summary.txt" \
  --paragraphsPath "path/to/paragraphs.json" \
  --outDir "./gitbook-space"
```

### 2. 更新 SUMMARY.md 目錄
```bash
node .agents/skills/podcast-publisher/publish-helper.js update-summary \
  --title "影片中文標題" \
  --slug "video-slug-name" \
  --summaryFile "./gitbook-space/SUMMARY.md"
```

---

## 常見錯誤 (Common Mistakes)
1. **術語誤翻**：將 "Salsa" 誤翻譯為「桑巴舞」（Samba 才是桑巴舞），或將 "congress" 誤翻譯為「國會」。
2. **SUMMARY.md 損壞**：手動編輯 `SUMMARY.md` 時意外刪除了縮排或破壞了既有文章連結。請一律使用 `publish-helper.js` 自動更新。
3. **簡體殘留**：直接輸出 Ollama 生成的小模型繁體，未經 normalization 機制過濾簡體字。
