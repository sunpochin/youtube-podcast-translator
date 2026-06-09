// src/services/gitbook.service.js
// GitBook 發佈與 GitOps 同步服務

import path from 'path';
import fs from 'fs/promises';
import childProcess from 'child_process';
import util from 'util';
import { generateCleanSlugFallback, generateSlug, formatTime } from '../utils/helpers.js';
import { translateTitleToSlug } from './ai.service.js';

// 封裝以利單元測試 Mock 模擬 Git 指令執行
export const gitExecutor = {
  exec: util.promisify(childProcess.execFile)
};


// 發佈翻譯文章至 GitBook 知識庫的核心邏輯
export async function publishToGitBook({ videoId, summary, translatedParagraphs, title, isLocal }) {
  // 取得 GitBook 目錄位置，預設嘗試同級目錄 ../social-dancing-notes，若不存在則退化至原路徑
  let gitbookDir = process.env.GITBOOK_PATH;
  if (!gitbookDir) {
    const siblingPath = path.resolve(process.cwd(), '../social-dancing-notes');
    const legacyPath = path.resolve(process.cwd(), '../interview/social-dancing-notes');
    let isSibling = false;
    try {
      await fs.access(siblingPath);
      isSibling = true;
    } catch (e) {
      isSibling = false;
    }
    gitbookDir = isSibling ? siblingPath : legacyPath;
  }
  const podcastDir = path.join(gitbookDir, 'podcast-translations');
  const summaryPath = path.join(gitbookDir, 'SUMMARY.md');

  // 在寫入本地檔案前，先拉取並重設為最新遠端狀態，避免多人併發或外部推送產生的 push conflict (Fast-Forward) 錯誤
  let currentBranch = 'main';
  try {
    const { stdout: branchStdout } = await gitExecutor.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitbookDir });
    currentBranch = branchStdout.trim();
    console.log(`[GitOps] 正在從遠端同步 GitBook (${currentBranch})...`);
    await gitExecutor.exec('git', ['fetch', 'origin'], { cwd: gitbookDir });
    await gitExecutor.exec('git', ['reset', '--hard', `origin/${currentBranch}`], { cwd: gitbookDir });
    console.log(`[GitOps] 同步成功，工作區已更新至最新遠端 commit`);
  } catch (syncErr) {
    console.warn('[GitOps] ⚠️ 遠端同步失敗，降級使用本地暫存狀態:', syncErr.message);
  }

  // 確保 podcast-translations 目錄存在
  await fs.mkdir(podcastDir, { recursive: true });

  // 產生檔名
  const slug = await translateTitleToSlug(title, videoId);
  const fileName = `${slug}.md`;
  const fullFilePath = path.join(podcastDir, fileName);
  const relativeFilePath = `podcast-translations/${fileName}`;

  // 確保寫入路徑嚴格限制在 podcast-translations 目錄下，防止路徑穿越攻擊
  const relativePathToCheck = path.relative(podcastDir, fullFilePath);
  if (relativePathToCheck.startsWith('..') || path.isAbsolute(relativePathToCheck)) {
    const err = new Error('非法檔案路徑，發佈路徑必須限制在 podcast-translations 目錄內！');
    err.statusCode = 400;
    throw err;
  }

  const SIGNATURE_MARKER = '<!-- gitbook-plugin-youtube-podcast-translator-auto-generated -->';

  // 嚴格防止覆蓋手寫 GitBook：如果檔案已存在，進行安全檢查
  let fileExists = false;
  try {
    await fs.access(fullFilePath);
    fileExists = true;
  } catch (e) {
    fileExists = false;
  }

  if (fileExists) {
    const existingContent = await fs.readFile(fullFilePath, 'utf-8');
    // 1. 如果原有檔案沒有印章，判定為主人的手寫檔案，絕對禁止覆蓋
    if (!existingContent.includes(SIGNATURE_MARKER)) {
      const err = new Error(`發佈失敗：檔案 ${fileName} 已存在，且沒有自動產生印章。這可能是您手動撰寫的文章，為保護您的手稿，已拒絕寫入。`);
      err.statusCode = 409;
      throw err;
    }

    // 2. 即使有印章，如果請求來自外部 (非本機 IP)，也拒絕覆蓋，防止外人洗掉內容
    if (!isLocal) {
      const err = new Error(`發佈失敗：檔案 ${fileName} 已經存在。為防止覆蓋現有內容，非本地發佈端點拒絕覆蓋現有的自動生成檔案。`);
      err.statusCode = 409;
      throw err;
    }
  }

  // 組裝 Markdown 內容 (提供新分頁開啟連結，並嵌入 YouTube 播放器以利在手機上邊聽邊看)
  // 第一行印上自動產生的印章，以便後續辨識
  let mdContent = `${SIGNATURE_MARKER}\n`;
  mdContent += `# 🎙️ ${title}\n\n`;
  mdContent += `> 影片連結: <a href="https://youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer">YouTube 網頁連結 (新分頁開啟)</a>\n\n`;
  mdContent += `### 影片嵌入觀看 (可邊放邊對照)\n`;
  mdContent += `<iframe width="100%" height="400" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>\n\n`;
  
  if (summary) {
    mdContent += `## 核心主旨與關鍵看點\n\n${summary}\n\n`;
  }
  mdContent += `## 中英雙語逐字稿對照\n\n`;
  translatedParagraphs.forEach(p => {
    mdContent += `### [${formatTime(p.start)} - ${formatTime(p.end)}]\n`;
    mdContent += `**英文原文**:\n${p.english}\n\n`;
    mdContent += `**中文對照**:\n${p.chinese}\n\n`;
    mdContent += `---\n\n`;
  });

  // 寫入 Markdown 檔案
  await fs.writeFile(fullFilePath, mdContent, 'utf-8');

  // 更新 SUMMARY.md (使用扁平無縮排格式以利手機閱讀)
  let summaryContent = await fs.readFile(summaryPath, 'utf-8');
  const linkEntry = `* [${title}](${relativeFilePath})`;

  if (!summaryContent.includes(relativeFilePath)) {
    const lines = summaryContent.split('\n');
    // 尋找是否已有 Podcast 翻譯分類，若無，先在後面追加一個 Group
    let groupIndex = lines.findIndex(line => line.includes('## Podcast 翻譯') || line.includes('## Podcast Translations'));
    
    if (groupIndex === -1) {
      // 如果沒有，在尾端追加分組
      lines.push('');
      lines.push('## Podcast 翻譯 <a href="#podcast-translations" id="podcast-translations"></a>');
      lines.push('');
      lines.push(linkEntry);
    } else {
      // 如果有，插入在該分組的下一行
      lines.splice(groupIndex + 1, 0, linkEntry);
    }
    summaryContent = lines.join('\n');
    await fs.writeFile(summaryPath, summaryContent, 'utf-8');
  }

  // 執行 Gitops push 並回傳 GitBook 頁面的網址
  const gitbookPageUrl = `https://sunpochin.gitbook.io/social-dancing-notes/podcast-translations/${slug}`;
  try {
    const { stdout: branchStdout } = await gitExecutor.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitbookDir });
    const currentBranch = branchStdout.trim();
    await gitExecutor.exec('git', ['add', '.'], { cwd: gitbookDir });
    await gitExecutor.exec('git', ['commit', '-m', `docs(podcast): add translation for ${title}`], { cwd: gitbookDir });
    await gitExecutor.exec('git', ['push', 'origin', currentBranch], { cwd: gitbookDir });
    return { success: true, message: `成功推送至 GitBook origin/${currentBranch} 分支！`, url: gitbookPageUrl };
  } catch (gitErr) {
    // 捕獲 nothing to commit 的警告
    if (gitErr.message.includes('nothing to commit') || gitErr.message.includes('working tree clean')) {
      return { success: true, message: '檔案已寫入本地，內容無變更無需推送。', url: gitbookPageUrl };
    }
    return { success: true, message: `檔案已成功寫入，但 Git 推送失敗: ${gitErr.message}`, url: gitbookPageUrl };
  }
}
