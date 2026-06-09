// server.js
// 專案主入口 (Express 伺服器與路由管理)

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { YoutubeTranscript } from 'youtube-transcript';

// 導入自訂中間件
import { isLocalRequest, verifyGitBookPassword, apiLimiter } from './src/middleware/auth.js';

// 導入 AI 翻譯服務與實體
import { ai, enqueueOllamaTask, translateWithOllama, summarizeWithOllama } from './src/services/ai.service.js';

// 導入 GitBook 發佈服務
import { publishToGitBook } from './src/services/gitbook.service.js';

// 導入通用輔助工具
import { extractVideoId, formatTime } from './src/utils/helpers.js';

dotenv.config();

// 檢查環境變數是否正確載入
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
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'dancewithai';

// 套用頻率限制保護 API 資源
app.use('/api/translate', apiLimiter);
app.use('/api/gitbook/publish', apiLimiter);

// 提供前端靜態檔案
app.use(express.static(path.join(process.cwd(), 'dashboard/dist')));

// API：檢測連線是否為本地開發環境
app.get('/api/connection-check', (req, res) => {
  res.json({ isLocal: isLocalRequest(req) });
});

// 1. 獲取 YouTube 影片字幕的 API
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
    const transcriptList = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    
    const formattedTranscript = transcriptList.map(item => ({
      text: item.text,
      start: item.offset / 1000,
      duration: item.duration / 1000
    }));

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

// 2. 呼叫 Gemini 2.5 Flash 或 Ollama 進行中英翻譯與分段摘要的 API (採用 SSE 串流傳輸)
app.post('/api/translate', async (req, res) => {
  const { transcript, videoId, mode, password, title } = req.body;
  if (!transcript || !Array.isArray(transcript)) {
    return res.status(400).json({ error: '無效的字幕資料' });
  }

  let isGeminiMode = mode === 'gemini';

  // 外部 IP 如果想要切換成 Gemini 模式，強制降級為本機 Ollama 引擎以防消耗額度/曝露金鑰
  if (isGeminiMode && !isLocalRequest(req)) {
    isGeminiMode = false;
    console.log(`[安全性限制] 外部請求來自 ${req.ip || req.socket?.remoteAddress}，強制將翻譯引擎由 Gemini 切換為本機 Ollama。`);
  }

  // 設定 Server-Sent Events (SSE) 標頭
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let connectionClosed = false;
  req.on('close', () => {
    connectionClosed = true;
    console.log(`[連線中斷] 用戶已關閉 Video ID: ${videoId} 的翻譯連線`);
  });

  try {
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
        translatedTitle = translatedTitle.replace(/^["'「」（(]+|["'「」（)]+$/g, '').trim();
        finalTitle = `${translatedTitle} - ${title}`;
      } else {
        finalTitle = title;
      }
      console.log(`[完成] 標題翻譯結果: ${finalTitle}`);
    }

    const results = [];

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
        const prompt = `
您是一位專業的同聲傳譯與 Podcast 導讀專家。請將以下這段 Podcast 的英文字幕段落進行精確、流暢的繁體中文（台灣習慣用語）翻譯。

背景資訊：
此 Podcast 內容與社交舞（Salsa、Bachata、Kizomba 等雙人社交舞/Social Dancing）與音樂文化密切相關。

翻譯規範：
1. 請保持文筆自然、感性且流暢，不要生硬地字對字翻譯。
2. 對於專業領域名詞，請務必遵循社交雙人舞領域的慣用術語。例如：
   - "congress" 或 "congresses" 指的是「舞蹈節」或「舞蹈大會」，絕對不要翻譯成「國會」或「議會」。
   - "social" 或 "socials" 指的是「舞會」或「社交舞會」，而非「社會」或「社交的」。
   - "lineup" 或 "lineups" 指的是「師資陣容」或「演出陣容」。
   - "festival" 指的是「舞蹈節」。
   - "workshop" 或 "workshops" 指的是「大師課」或「工作坊」。
3. 對於非領域名詞（如科技、人名），需保持台灣習用語，必要時保留英文。
4. 輸出格式必須僅包含翻譯後的繁體中文，不要包含任何前導詞或附帶說明。

英文原文：
"${englishText}"
`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });
        chineseText = response.text ? response.text.trim() : '（翻譯失敗）';
      } else {
        try {
          chineseText = await enqueueOllamaTask(() => translateWithOllama(englishText, 'qwen2.5:14b'));
        } catch (ollamaErr) {
          try {
            chineseText = await enqueueOllamaTask(() => translateWithOllama(englishText, 'qwen2.5:7b'));
          } catch (errInner) {
            throw new Error('本地 Ollama 服務未開啟，請在終端機執行 `ollama run qwen2.5:14b`，或切換為雲端 Gemini 模式。');
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

      const progress = Math.round(((i + 1) / chunks.length) * 100);
      res.write(`data: ${JSON.stringify({ type: 'chunk', chunk: resultItem, progress })}\n\n`);
    }

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

      res.write(`data: ${JSON.stringify({ type: 'summary', summary: summaryText })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', defaultTitle: finalTitle })}\n\n`);
      console.log(`[成功完成] Video ID: ${videoId} 翻譯完成`);
    }

    res.end();
  } catch (err) {
    console.error('AI 翻譯失敗:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || '翻譯過程中發生未知錯誤' })}\n\n`);
    res.end();
  }
});

// 3. 將翻譯發行到 GitBook
app.post('/api/gitbook/publish', verifyGitBookPassword, async (req, res) => {
  const { videoId, summary, translatedParagraphs, title } = req.body;
  if (!videoId || !translatedParagraphs || !title) {
    return res.status(400).json({ error: '缺少必要發佈參數' });
  }

  try {
    const isLocal = isLocalRequest(req);
    const result = await publishToGitBook({ videoId, summary, translatedParagraphs, title, isLocal });
    res.json(result);
  } catch (err) {
    console.error('GitBook 發佈失敗:', err);
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message || `寫入 GitBook 失敗: ${err.message}` });
  }
});

// 4. 將社交分享限動卡片同步發佈至社交發佈微服務
app.post('/api/social/publish', async (req, res) => {
  const { title, url, image } = req.body;
  if (!title || !url || !image) {
    return res.status(400).json({ error: '缺少必要分享參數' });
  }

  const caption = `🎙️ 我剛翻譯了一篇雙人社交舞 Podcast 筆記！\n\n標題：${title}\n閱讀全文對照：${url}\n\n#salsa #bachata #socialdancing #podcast`;

  try {
    console.log('[Microservice] 正在將分享卡片遞送至 social-post-service...');
    const socialServiceUrl = process.env.SOCIAL_POST_SERVICE_URL || 'http://localhost:3012/api/posts';
    
    // 設定 5 秒超時，防止微服務斷線造成主服務掛起
    const response = await fetch(socialServiceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caption,
        platforms: ['instagram'],
        image
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('[Microservice] 遞送成功！微服務回傳任務 ID:', data.jobId);
      return res.json({ success: true, jobId: data.jobId, message: '已成功排入發佈微服務佇列！' });
    }
    
    // 微服務有響應但回傳錯誤狀態碼（如 400 或 500），應回傳真實錯誤，不應降級模擬
    const errData = await response.json().catch(() => ({}));
    const errMsg = errData.error || `微服務回傳異常狀態: ${response.status}`;
    console.warn(`[Microservice] ⚠️ 微服務主動拒絕發佈: ${errMsg}`);
    return res.status(response.status).json({ error: errMsg });
  } catch (err) {
    console.warn('[Microservice] ⚠️ 微服務連線失敗，降級為模擬成功模式:', err.message);
    // 降級退化方案：在微服務未開啟時，回傳模擬成功，確保前端展示不報錯
    res.json({
      success: true,
      mocked: true,
      message: '本地發佈微服務未開啟，已自動降級為 Mock 模擬成功排程發佈！'
    });
  }
});

// Wildcard 路由指向 React 前端
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(process.cwd(), 'dashboard/dist/index.html'));
});

// 僅在非單元測試環境啟動 Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🎙️ Podcast Translator service running on http://localhost:${PORT}`);
  });
}

// 匯出 App 實體，以便測試與未來擴充
export default app;
