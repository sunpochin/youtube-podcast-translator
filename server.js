import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { YoutubeTranscript } from 'youtube-transcript';
import { GoogleGenAI } from '@google/genai';
import rateLimit from 'express-rate-limit';

dotenv.config();
// 檢查環境變數與當前工作目錄是否正確載入
console.log('=== Environment Variables Check ===');
console.log('Current CWD:', process.cwd());
console.log('GEMINI_API_KEY exists:', !!process.env.GEMINI_API_KEY);
if (process.env.GEMINI_API_KEY) {
  console.log('GEMINI_API_KEY prefix:', process.env.GEMINI_API_KEY.substring(0, 7) + '...');
}
console.log('==================================');

const app = express();
// 提高 JSON 請求大小限制，避免長影片字數過多時引發 PayloadTooLargeError
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3015;

// 設定訪問密碼
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'dancewithai';

// 招式三：IP 頻率限制 (每小時最多 2 次翻譯/發佈 API 呼叫，防範外部惡意洗流量)
const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小時
  max: 2, // 每個 IP 限制 2 次
  message: { error: '此 IP 已達每小時最大翻譯額度 (2次/小時)，請稍候再試。' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // 開發者本地測試 (localhost) 跳過限制
    const ip = req.ip || req.connection.remoteAddress || '';
    return ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost');
  }
});

// 套用頻率限制到翻譯與發佈端點
app.use('/api/translate', apiLimiter);
app.use('/api/gitbook/publish', apiLimiter);

// 判斷是否為本地請求的輔助函數
function isLocalRequest(req) {
  const ip = req.ip || req.connection.remoteAddress || '';
  return ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost');
}

// 授權中間件：發佈到 GitBook 必須驗證密碼
function verifyGitBookPassword(req, res, next) {
  const { password } = req.body;
  
  // 本地開發跳過密碼驗證
  if (isLocalRequest(req)) {
    return next();
  }

  if (!password || password !== ACCESS_PASSWORD) {
    return res.status(401).json({ error: '訪問密碼無效或未提供，外部用戶無權直接寫入 GitBook！' });
  }
  next();
}

// 簡單的本地 Ollama Mutex Queue 排隊鎖，保護 Mac Mini CPU/GPU 不會因併發請求而載荷過大崩潰
let ollamaQueuePromise = Promise.resolve();
async function enqueueOllamaTask(taskFn) {
  const nextTask = ollamaQueuePromise.then(() => taskFn());
  ollamaQueuePromise = nextTask.catch(() => {}); // 確保即使失敗也能繼續執行下一個
  return nextTask;
}

// API：檢測連線是否為本地開發環境
app.get('/api/connection-check', (req, res) => {
  res.json({ isLocal: isLocalRequest(req) });
});

// 初始化 Gemini 客户端，优先使用系统提供的 GEMINI_API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 提供前端静态文件
app.use(express.static(path.join(process.cwd(), 'dashboard/dist')));

// 提取 YouTube Video ID 辅助函数
function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// 1. 获取 YouTube 影片字幕的 API
app.post('/api/transcript', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: '請提供 YouTube 影片網址' });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: '無效的 YouTube 網址，找不到影片 ID' });
  }

  try {
    // 抓取英文字幕 (預設會優先嘗試抓取英文)
    const transcriptList = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    
    // 將字幕陣列整理成帶有時間戳記與內文的格式
    const formattedTranscript = transcriptList.map(item => ({
      text: item.text,
      start: item.offset / 1000, // 轉為秒數
      duration: item.duration / 1000
    }));

    // 取得 YouTube 影片標題 (透過 oEmbed API 避免需要 API Key)
    let videoTitle = '';
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        videoTitle = oembedData.title || '';
      }
    } catch (oembedErr) {
      console.warn('無法從 YouTube oEmbed 取得影片標題:', oembedErr.message);
    }

    res.json({ videoId, title: videoTitle, transcript: formattedTranscript });
  } catch (err) {
    console.error('抓取字幕失敗:', err);
    res.status(500).json({ error: `無法取得該影片的英文字幕。原因：${err.message || '該影片可能不支援或無英文字幕'}` });
  }
});

// 呼叫本地 Ollama 进行翻譯
async function translateWithOllama(englishText, modelName = 'qwen2.5:14b') {
  const prompt = `
您是一位專業的同聲傳譯與 Podcast 導讀專家。請將以下這段 Podcast 的英文字幕段落進行精確、流暢的繁體中文（台灣習慣用語）翻譯。

翻譯規範：
1. 請保持文筆自然、感性且流暢，不要生硬地字對字翻譯。
2. 對於專有名詞（如科技公司、人物名稱、專業術語）需保持台灣習用語，必要時保留英文。
3. 輸出格式必須僅包含翻譯後的繁體中文，不要包含任何前導詞或附帶說明。

英文原文：
"${englishText}"
`;

  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'user', content: prompt }
        ],
        stream: false
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama 響應失敗: ${response.status}`);
    }
    const data = await response.json();
    return data.message.content.trim();
  } catch (err) {
    console.warn(`[Ollama] ⚠️ 本地 Ollama 呼叫失敗，將降級或報錯:`, err.message);
    throw err;
  }
}

// 呼叫本地 Ollama 进行大綱生成
async function summarizeWithOllama(fullEnglishText, modelName = 'qwen2.5:14b') {
  const prompt = `
請閱讀以下 Podcast 前段內容，並以繁體中文整理出：
1. 這一集 Podcast 的核心主旨與探討內容。
2. 列出 3-4 個本集最值得關注的關鍵看點與精華摘要。

Podcast 內容：
"${fullEnglishText}"
`;

  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'user', content: prompt }
        ],
        stream: false
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama 摘要響應失敗: ${response.status}`);
    }
    const data = await response.json();
    return data.message.content.trim();
  } catch (err) {
    console.warn(`[Ollama] ⚠️ 本地 Ollama 摘要呼叫失敗:`, err.message);
    throw err;
  }
}

// 2. 呼叫 Gemini 2.5 Flash 或 Ollama 進行中英翻譯與分段摘要的 API (採用 SSE 串流傳輸)
app.post('/api/translate', async (req, res) => {
  const { transcript, videoId, mode, password, title } = req.body;
  if (!transcript || !Array.isArray(transcript)) {
    return res.status(400).json({ error: '無效的字幕資料' });
  }

  // 預設使用 Ollama 模式 (免費)，可傳入 'gemini' 參數以切換
  const isGeminiMode = mode === 'gemini';

  // 外部 IP 如果想要切換成 Gemini 模式，強制校驗密碼保護錢包
  if (isGeminiMode && !isLocalRequest(req)) {
    if (!password || password !== ACCESS_PASSWORD) {
      return res.status(401).json({ error: '訪問密碼無效，外部用戶無法直接呼叫雲端付費 Gemini 引擎！' });
    }
  }

  // 設定 Server-Sent Events (SSE) 標頭
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 監聽連線中斷，用於在使用者關閉視窗時停止剩餘的翻譯，節省運算與 Token 資源
  let connectionClosed = false;
  req.on('close', () => {
    connectionClosed = true;
    console.log(`[連線中斷] 用戶已關閉 Video ID: ${videoId} 的翻譯連線`);
  });

  try {
    // 為了降低 API 呼叫次數並節省 Token，我們將字幕段落進行分塊 (每 35 句合併為一個段落)
    const chunks = [];
    let currentChunk = [];
    
    transcript.forEach((item, index) => {
      currentChunk.push(item);
      if (currentChunk.length >= 35 || index === transcript.length - 1) {
        chunks.push([...currentChunk]);
        currentChunk = [];
      }
    });

    console.log(`[開始翻譯] 影片 ID: ${videoId}, 模式: ${mode}, 總分段數: ${chunks.length}`);

    // 翻譯影片標題 (如果前端有提供原始標題的話)
    let finalTitle = `Podcast 翻譯 - 影片 ${videoId}`;
    if (title && !connectionClosed) {
      console.log(`[進行中] 翻譯影片標題: ${title}`);
      const titlePrompt = `
請將以下這段英文的影片標題進行精確、流暢的繁體中文（台灣習慣用語）翻譯。

翻譯規範：
1. 輸出格式必須僅包含翻譯後的繁體中文，不要包含任何前導詞、說明或引號。

影片標題：
"${title}"
`;
      let translatedTitle = '';
      if (isGeminiMode) {
        const titleResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: titlePrompt,
        });
        translatedTitle = titleResponse.text ? titleResponse.text.trim() : '';
      } else {
        try {
          translatedTitle = await enqueueOllamaTask(() => translateWithOllama(title, 'qwen2.5:14b'));
        } catch (ollamaErr) {
          try {
            translatedTitle = await enqueueOllamaTask(() => translateWithOllama(title, 'qwen2.5:7b'));
          } catch (err) {
            translatedTitle = '';
          }
        }
      }

      if (translatedTitle) {
        // 去除外圍可能的多餘引號或括號
        translatedTitle = translatedTitle.replace(/^["'「」（(]+|["'「」（)]+$/g, '').trim();
        finalTitle = `${translatedTitle} - ${title}`;
      } else {
        finalTitle = title;
      }
      console.log(`[完成] 標題翻譯結果: ${finalTitle}`);
    }

    const results = [];

    // 依序翻譯每個分段並即時串流推送給前端
    for (let i = 0; i < chunks.length; i++) {
      if (connectionClosed) {
        console.log(`[停止翻譯] 連線已中斷，停止翻譯後續分段 (${i + 1}/${chunks.length})`);
        break;
      }

      const chunk = chunks[i];
      const startTime = chunk[0].start;
      const endTime = chunk[chunk.length - 1].start + chunk[chunk.length - 1].duration;
      const englishText = chunk.map(c => c.text).join(' ');

      console.log(`[進行中] 翻譯分段 ${i + 1}/${chunks.length}...`);
      let chineseText = '';

      if (isGeminiMode) {
        // 1. 使用 Gemini API 雲端翻譯
        const prompt = `
您是一位專業的同聲傳譯與 Podcast 導讀專家。請將以下這段 Podcast 的英文字幕段落進行精確、流暢的繁體中文（台灣習慣用語）翻譯。

翻譯規範：
1. 請保持文筆自然、感性且流暢，不要生硬地字對字翻譯。
2. 對於專有名詞（如科技公司、人物名稱、專業術語）需保持台灣習用語，必要時保留英文。
3. 輸出格式必須僅包含翻譯後的繁體中文，不要包含任何前導詞或附帶說明。

英文原文：
"${englishText}"
`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });
        chineseText = response.text ? response.text.trim() : '（翻譯失敗）';
      } else {
        // 2. 預設：使用本地 Mac Mini Ollama (使用 Queue 佇列排隊保護)
        try {
          chineseText = await enqueueOllamaTask(() => translateWithOllama(englishText, 'qwen2.5:14b'));
        } catch (ollamaErr) {
          // Ollama 連接錯誤或缺少 14b，退化使用 7b 嘗試
          try {
            chineseText = await enqueueOllamaTask(() => translateWithOllama(englishText, 'qwen2.5:7b'));
          } catch (errInner) {
            // 完全無法使用 Ollama 時，拋出詳細指引
            throw new Error('本地 Ollama 服務未開啟，請在 Mac Mini 終端機執行 `ollama run qwen2.5:14b`，或切換為雲端 Gemini 模式。');
          }
        }
      }

      const resultItem = {
        chunkIndex: i,
        start: startTime,
        end: endTime,
        english: englishText,
        chinese: chineseText
      };
      results.push(resultItem);

      // 計算目前翻譯完成百分比並推送給前端
      const progress = Math.round(((i + 1) / chunks.length) * 100);
      res.write(`data: ${JSON.stringify({ type: 'chunk', chunk: resultItem, progress })}\n\n`);
    }

    // 當所有分段翻譯完畢，且連線未中斷時，生成整集大綱摘要
    if (!connectionClosed) {
      console.log(`[進行中] 生成整集大綱摘要中...`);
      const fullEnglishText = results.map(r => r.english).slice(0, 8).join(' ');
      let summaryText = '';

      if (isGeminiMode) {
        const summaryPrompt = `
請閱讀以下 Podcast 前段內容，並以繁體中文整理出：
1. 這一集 Podcast 的核心主旨與探討內容。
2. 列出 3-4 個本集最值得關注的關鍵看點與精華摘要。

Podcast 內容：
"${fullEnglishText}"
`;
        const summaryResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: summaryPrompt,
        });
        summaryText = summaryResponse.text ? summaryResponse.text.trim() : '無法生成摘要。';
      } else {
        try {
          summaryText = await enqueueOllamaTask(() => summarizeWithOllama(fullEnglishText, 'qwen2.5:14b'));
        } catch (ollamaErr) {
          try {
            summaryText = await enqueueOllamaTask(() => summarizeWithOllama(fullEnglishText, 'qwen2.5:7b'));
          } catch (err) {
            summaryText = '本地大腦摘要生成失敗，請檢查 Ollama 運作狀態。';
          }
        }
      }

      // 推送大綱摘要並標記翻譯全部完成
      res.write(`data: ${JSON.stringify({ type: 'summary', summary: summaryText })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', defaultTitle: finalTitle })}\n\n`);
      console.log(`[成功完成] Video ID: ${videoId} 翻譯完成`);
    }

    res.end();

  } catch (err) {
    console.error('AI 翻譯失敗:', err);
    // 發生錯誤時將錯誤訊息經由 SSE 推送至前端，以利前端提示使用者
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || '翻譯過程中發生未知錯誤' })}\n\n`);
    res.end();
  }
});

// 輔助函式：將字串轉為 URL 友善的 Slug 格式，需與 GitBook 發布器一致
function generateSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-\u4e00-\u9fa5]+/g, '')
    .replace(/\-\-+/g, '-');
}

// 輔助執行 shell 指令
import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
const execFilePromise = util.promisify(execFile);

// 3. 將翻譯發行到 GitBook
app.post('/api/gitbook/publish', verifyGitBookPassword, async (req, res) => {
  const { videoId, summary, translatedParagraphs, title } = req.body;
  if (!videoId || !translatedParagraphs || !title) {
    return res.status(400).json({ error: '缺少必要發佈參數' });
  }

  // 取得 GitBook 目錄位置，預設退化至 ../interview/social-dancing-notes
  const gitbookDir = process.env.GITBOOK_PATH || path.resolve(process.cwd(), '../interview/social-dancing-notes');
  const podcastDir = path.join(gitbookDir, 'podcast-translations');
  const summaryPath = path.join(gitbookDir, 'SUMMARY.md');

  try {
    // 在寫入本地檔案前，先拉取並重設為最新遠端狀態，避免多人併發或外部推送產生的 push conflict (Fast-Forward) 錯誤
    let currentBranch = 'main';
    try {
      const { stdout: branchStdout } = await execFilePromise('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitbookDir });
      currentBranch = branchStdout.trim();
      console.log(`[GitOps] 正在從遠端同步 GitBook (${currentBranch})...`);
      await execFilePromise('git', ['fetch', 'origin'], { cwd: gitbookDir });
      await execFilePromise('git', ['reset', '--hard', `origin/${currentBranch}`], { cwd: gitbookDir });
      console.log(`[GitOps] 同步成功，工作區已更新至最新遠端 commit`);
    } catch (syncErr) {
      console.warn('[GitOps] ⚠️ 遠端同步失敗，降級使用本地暫存狀態:', syncErr.message);
    }

    // 確保 podcast-translations 目錄存在
    await fs.mkdir(podcastDir, { recursive: true });

    // 產生檔名
    const slug = generateSlug(title) || videoId;
    const fileName = `${slug}.md`;
    const fullFilePath = path.join(podcastDir, fileName);
    const relativeFilePath = `podcast-translations/${fileName}`;

    // 確保寫入路徑嚴格限制在 podcast-translations 目錄下，防止路徑穿越攻擊
    const relativePathToCheck = path.relative(podcastDir, fullFilePath);
    if (relativePathToCheck.startsWith('..') || path.isAbsolute(relativePathToCheck)) {
      return res.status(400).json({ error: '非法檔案路徑，發佈路徑必須限制在 podcast-translations 目錄內！' });
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
        return res.status(409).json({ error: `發佈失敗：檔案 ${fileName} 已存在，且沒有自動產生印章。這可能是您手動撰寫的文章，為保護您的手稿，已拒絕寫入。` });
      }

      // 2. 即使有印章，如果請求來自外部 (非本機 IP)，也拒絕覆蓋，防止外人洗掉內容
      if (!isLocalRequest(req)) {
        return res.status(409).json({ error: `發佈失敗：檔案 ${fileName} 已經存在。為防止覆蓋現有內容，非本地發佈端點拒絕覆蓋現有的自動生成檔案。` });
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

    // 更新 SUMMARY.md
    let summaryContent = await fs.readFile(summaryPath, 'utf-8');
    const linkEntry = `  * [${title}](${relativeFilePath})`;

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
      const { stdout: branchStdout } = await execFilePromise('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitbookDir });
      const currentBranch = branchStdout.trim();
      await execFilePromise('git', ['add', '.'], { cwd: gitbookDir });
      await execFilePromise('git', ['commit', '-m', `docs(podcast): add translation for ${title}`], { cwd: gitbookDir });
      await execFilePromise('git', ['push', 'origin', currentBranch], { cwd: gitbookDir });
      res.json({ success: true, message: `成功推送至 GitBook origin/${currentBranch} 分支！`, url: gitbookPageUrl });
    } catch (gitErr) {
      // 捕獲 nothing to commit 的警告
      if (gitErr.message.includes('nothing to commit') || gitErr.message.includes('working tree clean')) {
        return res.json({ success: true, message: '檔案已寫入本地，內容無變更無需推送。', url: gitbookPageUrl });
      }
      res.json({ success: true, message: `檔案已成功寫入，但 Git 推送失敗: ${gitErr.message}`, url: gitbookPageUrl });
    }

  } catch (err) {
    console.error('GitBook 發佈失敗:', err);
    res.status(500).json({ error: `寫入 GitBook 失敗: ${err.message}` });
  }
});

// 時間格式化輔助
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Wildcard 路由指向 React
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(process.cwd(), 'dashboard/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`🎙️ Podcast Translator service running on http://localhost:${PORT}`);
});
