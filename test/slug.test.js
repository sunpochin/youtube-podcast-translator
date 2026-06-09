// test/slug.test.js
// 針對 GitBook Slug 生成器與本地連線判斷輔助函式的單元測試，以及 Express 路由端點的整合測試

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { generateSlug, generateCleanSlugFallback } from '../src/utils/helpers.js';
import { isLocalRequest } from '../src/middleware/auth.js';
import app from '../server.js';

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

describe('Express API 路由整合測試', () => {
  let server;
  let baseUrl;

  before(() => {
    return new Promise((resolve) => {
      // 啟動測試用伺服器並動態分配連接埠，避免通訊埠衝突
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

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

  test('POST /api/translate - 非本地 IP 請求雲端模式但無驗證密碼時應返回 401', async () => {
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
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.ok(data.error.includes('訪問密碼無效'));
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
});
