// src/services/ai.service.js
// AI 翻譯與大綱生成服務 (整合 Gemini 與本地 Ollama)

import { GoogleGenAI } from '@google/genai';
import { generateCleanSlugFallback } from '../utils/helpers.js';

// 初始化 Gemini 智慧客戶端，優先使用 GEMINI_API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const ollamaModelConfig = {
  translate: process.env.OLLAMA_TRANSLATE_MODEL || 'qwen2.5:7b',
  translateFallback: process.env.OLLAMA_TRANSLATE_FALLBACK_MODEL || 'qwen2.5:14b',
  summary: process.env.OLLAMA_SUMMARY_MODEL || 'qwen2.5:7b',
  summaryFallback: process.env.OLLAMA_SUMMARY_FALLBACK_MODEL || 'qwen2.5:14b',
  slug: process.env.OLLAMA_SLUG_MODEL || 'qwen2.5:7b',
  slugFallback: process.env.OLLAMA_SLUG_FALLBACK_MODEL || 'qwen2.5:14b'
};

const zhNormalizationMap = new Map([
  ['PEOPLE', 'people'],
  ['People', 'people'],
  ['Alison Sanji', 'Alisson Sandi'],
  ['Alisson Sanji', 'Alisson Sandi'],
  ['alison sanji', 'Alisson Sandi'],
  ['alisson sanji', 'Alisson Sandi'],
  ['阿倫．桑吉', 'Alisson Sandi'],
  ['阿倫．桑吉', 'Alisson Sandi'],
  ['巴西佐克', 'Brazilian Zouk 舞'],
  ['巴西Zouk', 'Brazilian Zouk 舞'],
  ['佐克舞', 'Brazilian Zouk 舞'],
  ['桑巴舞', '莎莎舞'],
  ['沙薩舞', '莎莎舞'],
  ['沙薩', 'Salsa'],
  ['薩爾萨', 'Salsa'],
  ['薩爾薩', 'Salsa'],
  ['里', '裡'],
  ['里的', '裡的'],
  ['里面', '裡面'],
  ['发', '發'],
  ['体', '體'],
  ['个', '個'],
  ['这', '這'],
  ['种', '種'],
  ['为', '為'],
  ['与', '與'],
  ['后', '後'],
  ['传', '傳'],
  ['导', '導'],
  ['众', '眾'],
  ['会', '會'],
  ['议', '議'],
  ['师', '師'],
  ['乐', '樂'],
  ['习', '習'],
  ['让', '讓'],
  ['该', '該'],
  ['对', '對'],
  ['说', '說'],
  ['归', '歸'],
  ['类', '類'],
  ['于', '於'],
  ['阵', '陣'],
  ['气', '氣'],
  ['处', '處'],
  ['数', '數'],
  ['网', '網'],
  ['页', '頁'],
  ['视', '視'],
  ['频', '頻']
]);

export function normalizeTraditionalChineseOutput(text = '') {
  let normalized = String(text);
  normalized = normalized
    .replace(/^好的[，,]\s*以下是.*?[：:]\s*/u, '')
    .replace(/^以下是.*?[：:]\s*/u, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\*\*\s*/gm, '');
  for (const [source, target] of zhNormalizationMap.entries()) {
    normalized = normalized.replaceAll(source, target);
  }
  return normalized.trim();
}

function normalizeSummaryOutput(text = '') {
  let normalized = normalizeTraditionalChineseOutput(text);

  // 第二層：摘要專用後處理，模型如果還是多講話，就把前導包裝切掉。
  normalized = normalized
    .replace(/^好的[，,]\s*以下是.*?[：:]\s*/u, '')
    .replace(/^以下是.*?[：:]\s*/u, '')
    .replace(/^根據.*?整理[：:]\s*/u, '')
    .replace(/^Podcast 前段內容.*?[：:]\s*/u, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\*\s+/gm, '');

  const summaryTermMap = new Map([
    ['migrants', '移民'],
    ['migrant', '移民'],
    ['socials', '社交舞會'],
    ['social', '社交舞會'],
    ['DJs', 'DJ'],
    ['DJs', 'DJ'],
    ['dj', 'DJ'],
    ['teachers', '老師'],
    ['teacher', '老師'],
    ['people', '人們'],
    ['lineup', '師資陣容'],
    ['lineups', '師資陣容'],
    ['workshops', '大師課'],
    ['workshop', '大師課'],
    ['festival', '舞蹈節'],
    ['congress', '舞蹈節'],
    ['congresses', '舞蹈節']
  ]);

  for (const [source, target] of summaryTermMap.entries()) {
    normalized = normalized.replaceAll(source, target);
    normalized = normalized.replaceAll(source.toUpperCase(), target);
  }

  return normalized.trim();
}

export { normalizeSummaryOutput };

// 全域影片級翻譯排隊調度器 (Video-level Translation Queue Scheduler)
class TranslationQueueManager {
  constructor() {
    this.running = null; // 當前正在執行的任務 { id, videoId, title }
    this.queue = []; // 等待中的任務陣列
    this.jobCounter = 0;
  }

  enqueue(videoId, title, onWait, onStart) {
    const jobId = ++this.jobCounter;
    const job = { id: jobId, videoId, title, onStart, onWait };

    if (!this.running) {
      this.running = job;
      // 使用 process.nextTick 延遲執行，確保呼叫端已成功接收並賦值 jobId
      process.nextTick(() => onStart());
    } else {
      this.queue.push(job);
      const position = this.queue.length;
      onWait(position, this.running.title || this.running.videoId);
    }

    return jobId;
  }

  dequeue(jobId) {
    if (this.running && this.running.id === jobId) {
      this.running = null;
      if (this.queue.length > 0) {
        const nextJob = this.queue.shift();
        this.running = nextJob;
        // 延遲啟動下一個任務，確保事件循環健康
        process.nextTick(() => nextJob.onStart());
        // 更新其他排隊者的位置與當前正在執行的任務標題
        this.queue.forEach((job, index) => {
          job.onWait(index + 1, this.running.title || this.running.videoId);
        });
      }
    } else {
      this.queue = this.queue.filter(job => job.id !== jobId);
      this.queue.forEach((job, index) => {
        job.onWait(index + 1, this.running ? (this.running.title || this.running.videoId) : '其他任務');
      });
    }
  }
}

export const translationQueueManager = new TranslationQueueManager();

// 簡單的本地 Ollama Mutex Queue 排隊鎖，保護 Mac Mini CPU/GPU 不會因併發請求而載荷過大崩潰
let ollamaQueuePromise = Promise.resolve();
export async function enqueueOllamaTask(taskFn) {
  const nextTask = ollamaQueuePromise.then(() => taskFn());
  ollamaQueuePromise = nextTask.catch(() => {}); // 確保即使失敗也能繼續執行下一個
  return nextTask;
}

// 呼叫本地 Ollama 進行翻譯
export async function translateWithOllama(englishText, modelName = ollamaModelConfig.translate) {
  const prompt = `
您是一位專業的同聲傳譯與 Podcast 導讀專家。請將以下這段 Podcast 的英文字幕段落進行精確、流暢的繁體中文（台灣習慣用語）翻譯。

背景資訊：
此 Podcast 內容與社交舞（Salsa、Bachata、Kizomba 等雙人社交舞/Social Dancing）與音樂文化密切相關。

翻譯規範：
1. 請保持文筆自然、感性且流暢，但不要寫成解說文、評論文或自我介紹。
2. 請直接輸出翻譯結果，不要加上「好的」「以下是」「我來翻譯」這類前導語。
3. 對於專業領域名詞，請務必遵循社交雙人舞領域的慣用術語。例如：
   - "Salsa" 一律翻譯為「Salsa」或「莎莎舞」，絕對不要翻譯成「桑巴舞」、「沙薩」或簡體字。
   - "Bachata" 一律翻譯為「Bachata」或「巴恰塔」。
   - "Kizomba" 一律保留為「Kizomba」。
   - "Brazilian Zouk" 一律翻譯為「Brazilian Zouk 舞」，絕對不要翻譯成「巴西佐克」或「佐克舞」。
   - 語音辨識錯誤修正：字幕中的人名 "Alison Sanji" 或 "Alisson Sanji" 實為 Zouk 圈知名舞者 "Alisson Sandi"，請一律更正並翻譯為「Alisson Sandi」或「艾莉森」，切勿使用「阿倫．桑吉」。
   - "congress" 或 "congresses" 指的是「舞蹈節」或「舞蹈大會」，絕對不要翻譯成「國會」或「議會」。
   - "social" 或 "socials" 指的是「舞會」或「社交舞會」，而非「社會」或「社交的」。
   - "lineup" 或 "lineups" 指的是「師資陣容」或「演出陣容」。
   - "festival" 指的是「舞蹈節」。
   - "workshop" 或 "workshops" 指的是「大師課」或「工作坊」。
4. 對於非領域名詞（如科技、人名），需保持台灣習用語，必要時保留英文。
5. 如果原文出現專有名詞或縮寫，請保留原文或使用台灣常見寫法，不要自行發明新譯名。
6. 輸出格式必須僅包含翻譯後的繁體中文，不要包含任何前導詞、標題、項目符號或附帶說明。
7. 若句子很短，也請完整翻譯成自然中文，不要補充延伸評論。

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
      }),
      signal: AbortSignal.timeout(60000) // 設定 60 秒超時以釋放佇列鎖
    });
    if (!response.ok) {
      throw new Error(`Ollama 響應失敗: ${response.status}`);
    }
    const data = await response.json();
    return normalizeSummaryOutput(data.message.content);
  } catch (err) {
    console.warn(`[Ollama] ⚠️ 本地 Ollama 呼叫失敗，將降級或報錯:`, err.message);
    throw err;
  }
}

// 呼叫本地 Ollama 進行大綱生成
export async function summarizeWithOllama(fullEnglishText, modelName = ollamaModelConfig.summary) {
  const prompt = `
請閱讀以下 Podcast 前段內容，並以繁體中文整理出：
1. 這一集 Podcast 的核心主旨與探討內容。
2. 列出 3-4 個本集最值得關注的關鍵看點與精華摘要。

術語規範：
- "Salsa" 一律寫成「Salsa」或「莎莎舞」，絕對不要寫成「桑巴舞」、「沙薩」或簡體字。
- "Bachata" 一律寫成「Bachata」或「巴恰塔」。
- "Kizomba" 一律保留為「Kizomba」。
- "Brazilian Zouk" 一律寫成「Brazilian Zouk 舞」，絕對不要寫成「巴西佐克」。
- "social" 或 "socials" 在舞蹈脈絡下指「舞會」或「社交舞會」。
- 請直接輸出內容本身，不要在開頭加上寒暄、贅詞、標題、前言或「好的，以下是」這類回應語。
- 如果要用條列，直接從第一個重點開始，不要先寫引言。
- 不要輸出簡體字。

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
      }),
      signal: AbortSignal.timeout(60000) // 設定 60 秒超時以釋放佇列鎖
    });
    if (!response.ok) {
      throw new Error(`Ollama 摘要響應失敗: ${response.status}`);
    }
    const data = await response.json();
    return normalizeTraditionalChineseOutput(data.message.content);
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
4. 不要回覆句子、解釋或翻譯過程，只輸出最後 slug。

影片標題：
"${title}"
`;

  // 1. 優先使用本地免費的 Ollama 進行翻譯，確保完全免費與本地隱私
  try {
    console.log(`[Slug AI] 正在優先使用本地免費 Ollama (${ollamaModelConfig.slug}) 將標題翻譯為英文 Slug...`);
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModelConfig.slug,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      }),
      signal: AbortSignal.timeout(15000) // 標題翻譯為短文本，設定 15 秒超時
    });
    if (response.ok) {
      const data = await response.json();
      const slugText = data.message.content.trim().toLowerCase();
      const cleaned = slugText.replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+|-+$/g, '');
      if (cleaned && cleaned.length > 2) {
        console.log(`[Slug AI] Ollama ${ollamaModelConfig.slug} 翻譯結果: ${cleaned}`);
        return cleaned;
      }
    }
  } catch (err) {
    console.warn(`[Slug AI] ⚠️ Ollama ${ollamaModelConfig.slug} 翻譯 Slug 失敗，嘗試 ${ollamaModelConfig.slugFallback}...`, err.message);
    try {
      const response = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModelConfig.slugFallback,
          messages: [{ role: 'user', content: prompt }],
          stream: false
        }),
        signal: AbortSignal.timeout(15000) // 標題翻譯為短文本，設定 15 秒超時
      });
      if (response.ok) {
        const data = await response.json();
        const slugText = data.message.content.trim().toLowerCase();
        const cleaned = slugText.replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+|-+$/g, '');
        if (cleaned && cleaned.length > 2) {
          console.log(`[Slug AI] Ollama ${ollamaModelConfig.slugFallback} 翻譯結果: ${cleaned}`);
          return cleaned;
        }
      }
    } catch (eInner) {
      console.warn(`[Slug AI] ⚠️ Ollama ${ollamaModelConfig.slugFallback} 翻譯 Slug 也失敗`, eInner.message);
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
