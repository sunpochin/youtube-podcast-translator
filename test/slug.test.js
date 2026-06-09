// test/slug.test.js
// 針對 GitBook Slug 生成器與本地連線判斷輔助函式的單元測試

import test from 'node:test';
import assert from 'node:assert';
import { generateSlug, generateCleanSlugFallback, isLocalRequest } from '../server.js';

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

test('isLocalRequest - 應能正確辨識本機 IP 與外網 IP', () => {
  const mockReq1 = { ip: '127.0.0.1', connection: {} };
  const mockReq2 = { ip: '::1', connection: {} };
  const mockReq3 = { ip: 'localhost', connection: {} };
  const mockReq4 = { ip: '192.168.1.50', connection: {} };

  assert.strictEqual(isLocalRequest(mockReq1), true);
  assert.strictEqual(isLocalRequest(mockReq2), true);
  assert.strictEqual(isLocalRequest(mockReq3), true);
  assert.strictEqual(isLocalRequest(mockReq4), false);
});
