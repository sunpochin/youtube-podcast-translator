#!/usr/bin/env node

// publish-helper.js
// 本地 Agent Skill 輔助腳本：用於自動生成 GitBook 格式的 Markdown 與安全更新 SUMMARY.md

import fs from 'fs/promises';
import path from 'path';

const SIGNATURE_MARKER = '<!-- gitbook-plugin-youtube-podcast-translator-auto-generated -->';

// 輔助函式：格式化時間戳 (例如將秒數 65.5 轉換為 "01:05")
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');

  if (h > 0) {
    const hh = String(h).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

// 解析命令列參數的簡單小工具
function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = args[i + 1];
      if (val && !val.startsWith('--')) {
        parsed[key] = val;
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

// 列出使用說明的說明書
function printUsage() {
  console.log(`
使用說明:
  node publish-helper.js <command> [options]

指令列表:
  generate          生成 GitBook Markdown 檔案
  update-summary    更新 SUMMARY.md 的目錄連結

參數範例 (generate):
  --title           "Podcast 標題"
  --slug            "podcast-slug"
  --videoId         "VIDEO_ID"
  --summaryPath     "摘要內容文字檔路徑 (例如: ./summary.txt)"
  --paragraphsPath  "中英翻譯段落 JSON 檔路徑 (例如: ./paragraphs.json)"
  --outDir          "輸出目錄路徑 (預設為 ./)"
  --podcast         "Podcast 來源名稱 (例如: zouknerds，會自動加上版權版權聲明)"

參數範例 (update-summary):
  --title           "Podcast 標題"
  --slug            "podcast-slug"
  --summaryFile     "SUMMARY.md 檔案路徑"
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = parseArgs(args.slice(1));

  if (!command || options.help || options.h) {
    printUsage();
    process.exit(0);
  }

  try {
    if (command === 'generate') {
      const { title, slug, videoId, summaryPath, paragraphsPath, outDir = '.', podcast } = options;

      if (!title || !slug || !videoId || !paragraphsPath) {
        console.error('❌ 錯誤: 缺少必要參數 --title, --slug, --videoId 或 --paragraphsPath。');
        printUsage();
        process.exit(1);
      }

      // 偵測是否為 Zouk Nerds Podcast
      const isZoukNerds =
        (podcast && String(podcast).toLowerCase() === 'zouknerds') ||
        title.toLowerCase().includes('zouknerds') ||
        slug.toLowerCase().includes('zouknerds') ||
        outDir.toLowerCase().includes('zouknerds');

      // 載入翻譯段落資料
      const rawParagraphs = await fs.readFile(paragraphsPath, 'utf-8');
      const paragraphs = JSON.parse(rawParagraphs);

      // 載入摘要資料（選填）
      let summaryText = '';
      if (summaryPath) {
        summaryText = await fs.readFile(summaryPath, 'utf-8');
      }

      // 組裝符合 GitBook 樣式的 Markdown 內容
      const youtubeWatchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      let md = `${SIGNATURE_MARKER}\n`;
      md += `# 🎙️ ${title}\n\n`;
      // 改用 HTML 標籤來加入 target="_blank"
      md += `> 影片連結: <a href="${youtubeWatchUrl}" target="_blank">YouTube 網頁連結 (新分頁開啟)</a>\n\n`;
      md += `{% embed url="${youtubeWatchUrl}" %}\n\n`;

      if (isZoukNerds) {
        md += `## Video Source, Acknowledgement  影音來源\n\n`;
        md += `Special thanks to [Alisson Sandi](https://www.instagram.com/alisson.sandi/), host of the ZoukNerds Podcast, for graciously granting permission for this non-profit translation.\n\n`;
        md += `ZoukNerds: [${title}](${youtubeWatchUrl})\n\n`;
      }

      if (summaryText.trim()) {
        md += `## 核心主旨與關鍵看點\n\n${summaryText.trim()}\n\n`;
      }

      md += `## 中英雙語逐字稿對照\n\n`;
      paragraphs.forEach((p) => {
        md += `### [${formatTime(p.start)} - ${formatTime(p.end)}]\n`;
        md += `**英文原文**:\n${p.english}\n\n`;
        md += `**中文對照**:\n${p.chinese}\n\n`;
        md += `---\n\n`;
      });

      // 確保輸出目錄存在
      await fs.mkdir(outDir, { recursive: true });
      const targetFilePath = path.join(outDir, `${slug}.md`);

      // 安全寫入檢查：避免覆蓋手寫內容
      let fileExists = false;
      try {
        await fs.access(targetFilePath);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      if (fileExists) {
        const existing = await fs.readFile(targetFilePath, 'utf-8');
        if (!existing.includes(SIGNATURE_MARKER)) {
          console.error(`⚠️ 警告: 檔案 ${targetFilePath} 已存在且無自動產生標記 (印章)，已拒絕寫入以防覆蓋手稿！`);
          process.exit(1);
        }
      }

      await fs.writeFile(targetFilePath, md, 'utf-8');
      console.log(`✅ 成功生成 Markdown 檔案: ${targetFilePath}`);

    } else if (command === 'update-summary') {
      const { title, slug, summaryFile } = options;

      if (!title || !slug || !summaryFile) {
        console.error('❌ 錯誤: 缺少必要參數 --title, --slug 或 --summaryFile。');
        printUsage();
        process.exit(1);
      }

      const relativeFilePath = `podcast-translations/${slug}.md`;
      const linkEntry = `* [${title}](${relativeFilePath})`;

      let summaryContent = '';
      try {
        summaryContent = await fs.readFile(summaryFile, 'utf-8');
      } catch (err) {
        console.error(`❌ 錯誤: 無法讀取 SUMMARY.md: ${err.message}`);
        process.exit(1);
      }

      // 如果已包含此連結則不重複寫入
      if (summaryContent.includes(relativeFilePath)) {
        console.log(`ℹ️ SUMMARY.md 已包含此連結，無須重複更新。`);
        process.exit(0);
      }

      const lines = summaryContent.split('\n');
      let groupIndex = lines.findIndex(line => line.includes('## Podcast 翻譯') || line.includes('## Podcast Translations'));

      if (groupIndex === -1) {
        // 如果沒有 Podcast 翻譯分類，在尾端追加分組
        lines.push('');
        lines.push('## Podcast 翻譯 <a href="#podcast-translations" id="podcast-translations"></a>');
        lines.push('');
        lines.push(linkEntry);
      } else {
        // 插入在該分組的下一行
        lines.splice(groupIndex + 1, 0, linkEntry);
      }

      await fs.writeFile(summaryFile, lines.join('\n'), 'utf-8');
      console.log(`✅ SUMMARY.md 目錄更新成功！已加入連結: ${linkEntry}`);

    } else {
      console.error(`❌ 未知的指令: ${command}`);
      printUsage();
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 執行失敗:', error.message);
    process.exit(1);
  }
}

main();
