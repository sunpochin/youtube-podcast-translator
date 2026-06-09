// src/services/ai.service.js
// AI 翻譯與大綱生成服務 (整合 Gemini 與本地 Ollama)

import { GoogleGenAI } from '@google/genai';
import { generateCleanSlugFallback } from '../utils/helpers.js';

// 初始化 Gemini 智慧客戶端，優先使用 GEMINI_API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 簡單的本地 Ollama Mutex Queue 排隊鎖，保護 Mac Mini CPU/GPU 不會因併發請求而載荷過大崩潰
let ollamaQueuePromise = Promise.resolve();
export async function enqueueOllamaTask(taskFn) {
  const nextTask = ollamaQueuePromise.then(() => taskFn());
  ollamaQueuePromise = nextTask.catch(() => {}); // 確保即使失敗也能繼續執行下一個
  return nextTask;
}

// 呼叫本地 Ollama 進行翻譯
export async function translateWithOllama(englishText, modelName = 'qwen2.5:14b') {
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

// 呼叫本地 Ollama 進行大綱生成
export async function summarizeWithOllama(fullEnglishText, modelName = 'qwen2.5:14b') {
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

// 核心函式：透過 AI 將任何標題（特別是純中文標題）翻譯並轉換為乾淨的英文 URL Slug
export async function translateTitleToSlug(title, videoId) {
  const prompt = `
請將以下影片標題翻譯為英文，並轉換成 URL 友善的 Slug 格式。

規範：
1. 必須僅輸出 URL Slug：全部小寫，只包含英文字母、數字與連字號（-），例如 "weekly-phrase-theater-0602"。
2. 不要包含任何引號、前導詞、說明或任何非 URL 字元。
3. 如果標題本來就是英文，請直接將其轉為 Slug 格式。

影片標題：
"${title}"
`;

  // 1. 優先使用本地免費的 Ollama 14b / 7b 進行翻譯，確保完全免費與本地隱私
  try {
    console.log(`[Slug AI] 正在優先使用本地免費 Ollama (14b) 將標題翻譯為英文 Slug...`);
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:14b',
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    });
    if (response.ok) {
      const data = await response.json();
      const slugText = data.message.content.trim().toLowerCase();
      const cleaned = slugText.replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+|-+$/g, '');
      if (cleaned && cleaned.length > 2) {
        console.log(`[Slug AI] Ollama 14b 翻譯結果: ${cleaned}`);
        return cleaned;
      }
    }
  } catch (err) {
    console.warn(`[Slug AI] ⚠️ Ollama 14b 翻譯 Slug 失敗，嘗試 7b...`, err.message);
    try {
      const response = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:7b',
          messages: [{ role: 'user', content: prompt }],
          stream: false
        })
      });
      if (response.ok) {
        const data = await response.json();
        const slugText = data.message.content.trim().toLowerCase();
        const cleaned = slugText.replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+|-+$/g, '');
        if (cleaned && cleaned.length > 2) {
          console.log(`[Slug AI] Ollama 7b 翻譯結果: ${cleaned}`);
          return cleaned;
        }
      }
    } catch (eInner) {
      console.warn(`[Slug AI] ⚠️ Ollama 7b 翻譯 Slug 也失敗`, eInner.message);
    }
  }

  // 2. 降級使用雲端 Gemini 2.5 Flash 進行翻譯 (需要 API Key，有潛在額度成本)
  try {
    if (process.env.GEMINI_API_KEY) {
      console.log(`[Slug AI] 正在降級使用 Gemini 將標題翻譯為英文 Slug...`);
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      const slugText = response.text ? response.text.trim().toLowerCase() : '';
      const cleaned = slugText.replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+|-+$/g, '');
      if (cleaned && cleaned.length > 2) {
        console.log(`[Slug AI] Gemini 翻譯結果: ${cleaned}`);
        return cleaned;
      }
    }
  } catch (err) {
    console.warn(`[Slug AI] ⚠️ Gemini 翻譯 Slug 失敗`, err.message);
  }

  // 3. 若 AI 翻譯全部失敗，使用正則與影片 ID 退化方案
  console.log(`[Slug AI] ⚠️ AI 翻譯 Slug 全部失敗，使用正則退化方案`);
  return generateCleanSlugFallback(title, videoId);
}

// 供外部使用的 Gemini 連線模組
export { ai };
