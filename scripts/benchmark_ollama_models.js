import { performance } from 'node:perf_hooks';

// 這份 script 的目的很單純：
// 用同一套 prompt、同一套整理規則、同一台機器，去比不同 Ollama model 的速度和穩定度。
const DEFAULT_MODELS = [
  'qwen2.5:7b',
  'qwen2.5:14b',
  'qwen3:4b',
  'gemma3:4b',
  'gemma3n:e4b',
  'llama3.1:8b',
  'mistral:7b'
];

// 每個 case 都是同一類工作流中的一種代表：
// 1) 短句翻譯，測基本速度
// 2) 領域翻譯，測術語和語意控制
// 3) 摘要，測長輸出和穩定度
const CASES = [
  {
    name: 'translation-short',
    prompt: `
您是一位專業的同聲傳譯與 Podcast 導讀專家。請將以下這段 Podcast 的英文字幕段落進行精確、流暢的繁體中文（台灣習慣用語）翻譯。

翻譯規範：
1. "Salsa" 一律翻譯為「Salsa」或「莎莎舞」，絕對不要翻譯成「桑巴舞」、「沙薩」或簡體字。
2. "socials" 指的是「舞會」或「社交舞會」。
3. 輸出格式必須僅包含翻譯後的繁體中文，不要包含任何前導詞或附帶說明。

英文原文：
"Salsa is a living culture carried by dancers, DJs, teachers, and late-night socials."
`.trim()
  },
  {
    name: 'translation-domain',
    prompt: `
您是一位專業的同聲傳譯與 Podcast 導讀專家。請將以下這段 Podcast 的英文字幕段落進行精確、流暢的繁體中文（台灣習慣用語）翻譯。

翻譯規範：
1. "Salsa" 一律翻譯為「Salsa」或「莎莎舞」，絕對不要翻譯成「桑巴舞」、「沙薩」或簡體字。
2. "congress" 指的是「舞蹈節」或「舞蹈大會」，絕對不要翻譯成「國會」。
3. "socials" 指的是「舞會」或「社交舞會」。
4. "lineup" 指的是「師資陣容」或「演出陣容」。
5. 輸出格式必須僅包含翻譯後的繁體中文，不要包含任何前導詞或附帶說明。

英文原文：
"A great congress depends on music, community trust, and a lineup that makes people stay for the socials."
`.trim()
  },
  {
    name: 'summary-short',
    prompt: `
請閱讀以下 Podcast 前段內容，並以繁體中文整理出：
1. 這一集 Podcast 的核心主旨與探討內容。
2. 列出 3 個本集最值得關注的關鍵看點與精華摘要。

術語規範：
- "Salsa" 一律寫成「Salsa」或「莎莎舞」，絕對不要寫成「桑巴舞」、「沙薩」或簡體字。
- "social" 或 "socials" 在舞蹈脈絡下指「舞會」或「社交舞會」。

Podcast 內容：
"Salsa is not just choreography. It is a living culture shaped by migration, local scenes, DJs, teachers, and the way people gather at socials after class."
`.trim()
  }
];

function analyzeOutput(text) {
  // 這裡不是做嚴格 NLP 評分，只做快速人工判斷用的安全檢查。
  // 如果輸出已經出現明顯錯詞、簡體字或術語錯置，就先視為不合格候選。
  return {
    containsSalsaOrChinese: /Salsa|莎莎舞/.test(text),
    containsBadTerm: /桑巴舞|沙薩|薩爾萨|简体|简/.test(text),
    containsCongressMistake: /國會|议会|議會/.test(text),
    likelySimplified: /这|种|为|与|体|会|师|乐|习|让|该|对|说|处|数|页/.test(text)
  };
}

async function runCase(model, testCase) {
  // wall time 是使用者真正感受到的等待時間。
  // total/load/eval 則是 Ollama 回傳的內部計時，用來拆開看瓶頸在哪。
  const startedAt = performance.now();
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: testCase.prompt }],
      stream: false,
      options: { temperature: 0 }
    }),
    signal: AbortSignal.timeout(90000)
  });

  const wallMs = Math.round(performance.now() - startedAt);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();
  const text = (json.message?.content || '').trim();

  return {
    case: testCase.name,
    wall_ms: wallMs,
    total_ms: Math.round((json.total_duration || 0) / 1e6),
    load_ms: Math.round((json.load_duration || 0) / 1e6),
    eval_ms: Math.round((json.eval_duration || 0) / 1e6),
    prompt_eval_count: json.prompt_eval_count || 0,
    eval_count: json.eval_count || 0,
    // preview 只保留前面一小段，方便快速掃結果，不把整段輸出塞滿報表。
    output_preview: text.replace(/\s+/g, ' ').slice(0, 220),
    checks: analyzeOutput(text)
  };
}

async function main() {
  // 允許從命令列傳入 model 名稱；沒傳就跑預設清單。
  const models = process.argv.slice(2);
  const targetModels = models.length > 0 ? models : DEFAULT_MODELS;
  const results = [];

  for (const model of targetModels) {
    const modelResults = [];
    for (const testCase of CASES) {
      try {
        modelResults.push(await runCase(model, testCase));
      } catch (error) {
        modelResults.push({
          case: testCase.name,
          error: error.message
        });
      }
    }
    results.push({ model, results: modelResults });
  }

  // 最後直接輸出 JSON，方便複製、存檔，或之後再做表格整理。
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
