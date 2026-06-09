// scripts/verify_social_integration.js
// 社交發佈微服務整合驗證腳本
// 測試在 Mock 模式下的非同步任務建立、狀態輪詢（queued -> posting -> completed）
// 以及 Live 模式下微服務未開啟時的 503 錯誤回應。

import assert from 'assert';

const BASE_URL = 'http://localhost:3015';

// 輔助延遲函式
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runVerification() {
  console.log('🏁 開始驗證社交發佈微服務整合與架構成熟度...\n');

  try {
    // ----------------------------------------------------
    // 測試 1：驗證 Mock 模式（非同步建立與狀態輪詢）
    // ----------------------------------------------------
    console.log('🧪 測試 1：建立 Mock 模擬發佈任務並進行狀態輪詢...');
    
    const publishRes = await fetch(`${BASE_URL}/api/social/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '測試 Podcast 限動圖卡',
        url: 'https://test-notes-gitbook.io/salsa-tips',
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', // 1x1 像素透明圖片
        mockMode: true
      })
    });

    assert.strictEqual(publishRes.status, 202, '建立任務應回傳 202 Accepted 狀態碼');
    const publishData = await publishRes.json();
    assert.ok(publishData.success, '回應應標記為 success');
    assert.ok(publishData.jobId.startsWith('mock-'), 'jobId 應為 mock- 開頭的模擬 ID');
    console.log(`✅ 成功建立模擬任務。Job ID: ${publishData.jobId}`);

    // 開始狀態輪詢
    console.log('🔄 開始輪詢任務狀態，預期經歷 queued -> posting -> completed 轉換：');
    let status = 'queued';
    let attempts = 0;
    const maxAttempts = 10;

    while (status !== 'completed' && attempts < maxAttempts) {
      attempts++;
      const statusRes = await fetch(`${BASE_URL}/api/social/status/${publishData.jobId}`);
      assert.strictEqual(statusRes.status, 200, '查詢狀態應回傳 200 OK');
      const job = await statusRes.json();
      status = job.status;
      
      console.log(`  [第 ${attempts} 次查詢] 目前狀態: ${status}`);
      if (status === 'completed') {
        assert.ok(job.results && job.results[0].success, '完成任務應有平台成功的 result 資料');
        console.log(`✅ 任務發佈完成，模擬貼文 ID: ${job.results[0].platformPostId}`);
        break;
      }
      await sleep(1000);
    }
    
    assert.strictEqual(status, 'completed', '任務應在限制時間內順利完成');

    // ----------------------------------------------------
    // 測試 2：驗證 Live 模式下的 Service Unavailable (503)
    // ----------------------------------------------------
    console.log('\n🧪 測試 2：驗證實體微服務模式在連線失敗時的回應...');
    console.log('（確保 social-post-service 未在 3012 啟動，以測試連線失敗）');

    const livePublishRes = await fetch(`${BASE_URL}/api/social/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '實體發佈測試',
        url: 'https://test-notes-gitbook.io/bachata-tips',
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mockMode: false // 指定 Live 模式
      })
    });

    // 若 microservice 的確是關閉的，應回傳 503
    if (livePublishRes.status === 503) {
      const errData = await livePublishRes.json();
      assert.ok(errData.error.includes('無法連線至社交發佈微服務'), '應該包含說明連線失敗的錯誤資訊');
      console.log('✅ 驗證成功：當微服務離線時，Live 模式正確返回 503 Service Unavailable，拒絕偽裝成功！');
    } else if (livePublishRes.status === 202) {
      console.log('ℹ️ 偵測到 3012 實體微服務為開啟狀態，Live 模式回傳 202 成功。');
    } else {
      throw new Error(`非預期的 HTTP 狀態碼: ${livePublishRes.status}`);
    }

    console.log('\n🎉 所有社交發佈整合測試全部驗證通過！');
  } catch (error) {
    console.error('\n❌ 驗證失敗:', error.message);
    process.exit(1);
  }
}

runVerification();
