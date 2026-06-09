// test/slug.test.js
// 針對 GitBook Slug 生成器與本地連線判斷輔助函式的單元測試，以及 Express 路由端點的整合測試

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'fs/promises';
import path from 'path';
import { generateSlug, generateCleanSlugFallback } from '../src/utils/helpers.js';
import { isLocalRequest } from '../src/middleware/auth.js';
import { translateWithOllama, summarizeWithOllama, translateTitleToSlug, ai } from '../src/services/ai.service.js';
import { publishToGitBook, gitExecutor } from '../src/services/gitbook.service.js';
import app from '../server.js';

// ==========================================
// 🧱 基礎單元測試區 (Unit Tests)
// 不需要 Mock，直接測試「輸入」與「輸出」的純函數積木
// ==========================================

test('generateSlug - 應能正確清理中文與空格符號', () => {
  const result = generateSlug('每週一句小劇場 【0602】');
  assert.strictEqual(result, '每週一句小劇場-0602');
});

test('generateSlug - 應能處理中英雙語並忽略特殊符號', () => {
  const result = generateSlug('自我不會消失 - The ego doesn\'t disappear');
  assert.strictEqual(result, '自我不會消失-the-ego-doesnt-disappear');
});

test('generateCleanSlugFallback - 應優先提取英文標題並去除中文部分', () => {
  const result = generateCleanSlugFallback('自我不會消失 - The ego doesn\'t disappear | Fernando Sosa', 'video123');
  assert.strictEqual(result, 'the-ego-doesnt-disappear-fernando-sosa');
});

test('generateCleanSlugFallback - 當標題無英文時，應降級回退到含中文的 Slug', () => {
  const result = generateCleanSlugFallback('每週一句小劇場', 'video123');
  assert.strictEqual(result, '每週一句小劇場');
});

test('generateCleanSlugFallback - 當標題為空時，應降級回退為影片 ID', () => {
  const result = generateCleanSlugFallback('', 'video123');
  assert.strictEqual(result, 'video123');
});

test('isLocalRequest - 應能正確辨識本機 IP 與外網 IP，並支援模擬標頭', () => {
  const mockReq1 = { ip: '127.0.0.1', connection: {} };
  const mockReq2 = { ip: '::1', connection: {} };
  const mockReq3 = { ip: 'localhost', connection: {} };
  const mockReq4 = { ip: '192.168.1.50', connection: {} };
  const mockReq5 = { headers: { 'x-mock-ip': '127.0.0.1' } };
  const mockReq6 = { headers: { 'x-mock-ip': '192.168.1.50' } };

  assert.strictEqual(isLocalRequest(mockReq1), true);
  assert.strictEqual(isLocalRequest(mockReq2), true);
  assert.strictEqual(isLocalRequest(mockReq3), true);
  assert.strictEqual(isLocalRequest(mockReq4), false);
  assert.strictEqual(isLocalRequest(mockReq5), true);
  assert.strictEqual(isLocalRequest(mockReq6), false);
});

// ==========================================
// 🌐 Express API 路由整合測試區
// 在測試環境中啟動一個真實的 HTTP 伺服器，測試端點響應
// ==========================================

describe('Express API 路由整合測試', () => {
  let server;
  let baseUrl;

  // 在所有測試開始前 (before) 啟動測試伺服器
  before(() => {
    // 強制將微服務指向無效連接埠，確保斷線與降級測試的獨立性與穩定性
    process.env.SOCIAL_POST_SERVICE_URL = 'http://127.0.0.1:59999/api/posts';
    return new Promise((resolve) => {
      // 啟動測試用伺服器並動態分配連接埠 (port: 0)，避免通訊埠衝突
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  // 在所有測試結束後 (after) 關閉測試伺服器以釋放資源
  after(() => {
    return new Promise((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  test('GET /api/connection-check - 應能識別本地請求', async () => {
    const res = await fetch(`${baseUrl}/api/connection-check`, {
      headers: { 'x-mock-ip': '127.0.0.1' }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.isLocal, true);
  });

  test('GET /api/connection-check - 應能識別非本地請求', async () => {
    const res = await fetch(`${baseUrl}/api/connection-check`, {
      headers: { 'x-mock-ip': '192.168.1.50' }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.isLocal, false);
  });

  test('POST /api/transcript - 缺少影片網址參數應返回 400', async () => {
    const res = await fetch(`${baseUrl}/api/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('請提供 YouTube 影片網址'));
  });

  test('POST /api/transcript - 無效的影片網址應返回 400', async () => {
    const res = await fetch(`${baseUrl}/api/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://invalid-url.com' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('無效的 YouTube 網址'));
  });

  test('POST /api/translate - 缺少逐字稿字幕時應返回 400', async () => {
    const res = await fetch(`${baseUrl}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: 'video123', mode: 'ollama' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('無效的字幕資料'));
  });

  test('POST /api/translate - 非本地 IP 請求雲端模式時，應回傳 200 並自動降級為 Ollama 處理', async () => {
    const res = await fetch(`${baseUrl}/api/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mock-ip': '192.168.1.50'
      },
      body: JSON.stringify({
        transcript: [{ text: 'hello', start: 0, duration: 1 }],
        videoId: 'video123',
        mode: 'gemini'
      })
    });
    // 因為 SSE 啟動時會立即回傳 200 建立連接，後續才異步降級為 Ollama 推理
    assert.strictEqual(res.status, 200);
  });

  test('POST /api/gitbook/publish - 非本地 IP 請求發佈時應返回 403 拒絕寫入', async () => {
    const res = await fetch(`${baseUrl}/api/gitbook/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mock-ip': '192.168.1.50'
      },
      body: JSON.stringify({
        videoId: 'video123',
        summary: '摘要',
        translatedParagraphs: [{ start: 0, end: 1, english: 'Hi', chinese: '嗨' }],
        title: '標題'
      })
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('安全限制'));
  });

  test('POST /api/gitbook/publish - 缺少必要發佈參數時應返回 400', async () => {
    const res = await fetch(`${baseUrl}/api/gitbook/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: 'video123' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('缺少必要發佈參數'));
  });

  test('POST /api/social/publish - 缺少分享參數應返回 400', async () => {
    const res = await fetch(`${baseUrl}/api/social/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '測試' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('缺少必要分享參數'));
  });

  test('POST /api/social/publish - Live 模式在微服務斷線時應明確返回 503', async () => {
    const res = await fetch(`${baseUrl}/api/social/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '測試標題',
        url: 'https://test-gitbook.com/123',
        image: 'data:image/png;base64,mocked-base64',
        mockMode: false // 指定 Live 模式
      })
    });
    // 當微服務沒開時，Live 模式必須傳回 503 服務不可用
    assert.strictEqual(res.status, 503);
    const data = await res.json();
    assert.ok(data.error.includes('無法連線至社交發佈微服務'));
  });

  test('POST & GET /api/social/publish & status - Mock 模式應返回 202 並可正確輪詢狀態', async () => {
    const publishRes = await fetch(`${baseUrl}/api/social/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '測試標題',
        url: 'https://test-gitbook.com/123',
        image: 'data:image/png;base64,mocked-base64',
        mockMode: true // 指定 Mock 模式
      })
    });

    assert.strictEqual(publishRes.status, 202);
    const publishData = await publishRes.json();
    assert.strictEqual(publishData.success, true);
    assert.ok(publishData.jobId.startsWith('mock-'));

    // 測試輪詢狀態端點
    const statusRes = await fetch(`${baseUrl}/api/social/status/${publishData.jobId}`);
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.jobId, publishData.jobId);
    assert.ok(['queued', 'posting', 'completed'].includes(statusData.status));
  });
});

// ==========================================
// 🎭 AI & GitBook Services Mock 測試區
// 使用玩具替身 (Mock) 攔截危險/昂貴的外部 API 與 Git 指令
// ==========================================

describe('AI & GitBook Services 單元測試與 Mock 驗證', () => {

  // 測試 1：用 Mock 模擬本地 Ollama LLM 的網路響應
  test('translateWithOllama - 應正確模擬 Ollama HTTP 請求並返回翻譯', async (t) => {
    // t.mock.method 會攔截 globalThis (全域環境) 上的 fetch 函數
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.strictEqual(url, 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(options.body);
      assert.strictEqual(body.model, 'qwen2.5:14b');
      // 直接傳回假的 HTTP 響應，不真的打去 Ollama
      return {
        ok: true,
        json: async () => ({
          message: { content: '這是一段翻譯後的中文' }
        })
      };
    });

    const result = await translateWithOllama('This is some English text', 'qwen2.5:14b');
    assert.strictEqual(result, '這是一段翻譯後的中文');
  });

  // 測試 2：模擬 Ollama 摘要生成
  test('summarizeWithOllama - 應正確模擬 Ollama 摘要 HTTP 請求', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.strictEqual(url, 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(options.body);
      assert.strictEqual(body.model, 'qwen2.5:14b');
      return {
        ok: true,
        json: async () => ({
          message: { content: '這是整集摘要內容' }
        })
      };
    });

    const result = await summarizeWithOllama('This is full podcast content', 'qwen2.5:14b');
    assert.strictEqual(result, '這是整集摘要內容');
  });

  // 測試 3：驗證 Ollama 正常運作時，translateTitleToSlug 的處理結果
  test('translateTitleToSlug - 當預設 Ollama slug model 成功時，應直接使用其結果並過濾特殊字元', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.model, 'qwen2.5:7b');
      return {
        ok: true,
        json: async () => ({
          message: { content: 'mocked-ollama-fast-slug!' }
        })
      };
    });

    const result = await translateTitleToSlug('每週一句小劇場', 'video123');
    assert.strictEqual(result, 'mocked-ollama-fast-slug');
  });

  // 測試 4：驗證本地 Ollama 斷線時，系統能自動降級 Mock 呼叫雲端 Gemini 的機制
  test('translateTitleToSlug - 當 Ollama 失敗但 Gemini 成功時，應降級使用 Gemini 並過濾特殊字元', async (t) => {
    // 模擬 Ollama 連線失敗拋出異常
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('Ollama offline');
    });

    // 模擬 Gemini 客戶端 (ai.models) 的 generateContent 方法
    t.mock.method(ai.models, 'generateContent', async () => {
      return {
        text: 'mocked-gemini-slug!'
      };
    });

    const result = await translateTitleToSlug('每週一句小劇場', 'video123');
    assert.strictEqual(result, 'mocked-gemini-slug');
  });

  // 測試 5：GitBook 本地寫入與 GitOps 安全發佈的沙盒模擬
  describe('publishToGitBook 整合與安全防護測試 (Sandboxed)', () => {
    const sandboxDir = path.join(process.cwd(), 'test_gitbook_sandbox');

    // 建立一個臨時的測試沙盒目錄，避免改動到真實的筆記庫
    before(async () => {
      process.env.GITBOOK_PATH = sandboxDir;
      await fs.mkdir(sandboxDir, { recursive: true });
      await fs.writeFile(path.join(sandboxDir, 'SUMMARY.md'), '# Summary\n\n## Podcast 翻譯\n', 'utf-8');
    });

    // 測試結束後清理沙盒，保持環境乾淨
    after(async () => {
      delete process.env.GITBOOK_PATH;
      await fs.rm(sandboxDir, { recursive: true, force: true });
    });

    test('publishToGitBook - 應成功寫入檔案、更新 SUMMARY.md 並執行完整的 GitOps 指令', async (t) => {
      const gitCalls = [];
      // 攔截並 Mock 模擬 Git 指令執行，不真的推送程式碼
      t.mock.method(gitExecutor, 'exec', async (cmd, args) => {
        gitCalls.push({ cmd, args }); // 將呼叫參數記錄下來供後續 Assert 驗證
        if (args.includes('rev-parse')) {
          return { stdout: 'main' };
        }
        return { stdout: '' };
      });

      // 攔截 AI 生成標題的請求
      t.mock.method(globalThis, 'fetch', async () => {
        return {
          ok: true,
          json: async () => ({
            message: { content: 'test-slug' }
          })
        };
      });

      const res = await publishToGitBook({
        videoId: 'uSYCduNg1oc',
        summary: '這是一個測試大綱',
        translatedParagraphs: [
          { start: 0, end: 10, english: 'Hello', chinese: '你好' }
        ],
        title: '測試影片標題',
        isLocal: true
      });

      assert.strictEqual(res.success, true);
      assert.ok(res.url.includes('test-slug'));

      // 驗證自動產生的印章與標題寫入
      const fileContent = await fs.readFile(path.join(sandboxDir, 'podcast-translations/test-slug.md'), 'utf-8');
      assert.ok(fileContent.includes('<!-- gitbook-plugin-youtube-podcast-translator-auto-generated -->'));
      assert.ok(fileContent.includes('測試影片標題'));
      assert.ok(fileContent.includes('> 影片連結: [YouTube 網頁連結 (新分頁開啟)](https://www.youtube.com/watch?v=uSYCduNg1oc)'));
      assert.ok(fileContent.includes('{% embed url="https://www.youtube.com/watch?v=uSYCduNg1oc" %}'));
      assert.ok(!fileContent.includes('<iframe'), 'GitBook publish markdown should use official embed syntax instead of raw iframe');

      // 驗證 SUMMARY.md 被正確更新 (扁平無縮排格式)
      const summaryContent = await fs.readFile(path.join(sandboxDir, 'SUMMARY.md'), 'utf-8');
      assert.ok(summaryContent.includes('* [測試影片標題](podcast-translations/test-slug.md)'));

      // 驗證 Git 命令執行的順序與完整性 (檢查程式有沒有照流程做事)
      const gitCmds = gitCalls.map(c => c.args[0] || c.args[1]);
      assert.ok(gitCmds.includes('fetch'));
      assert.ok(gitCmds.includes('reset'));
      assert.ok(gitCmds.includes('add'));
      assert.ok(gitCmds.includes('commit'));
      assert.ok(gitCmds.includes('push'));
    });
  });
});
