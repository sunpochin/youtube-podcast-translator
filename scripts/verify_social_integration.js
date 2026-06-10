// scripts/verify_social_integration.js
// 社交發佈微服務整合驗證腳本
// 測試 translator 只負責代理，實際任務建立與狀態輪詢由 social-post-service 負責。
// 需要先啟動 youtube-podcast-translator (3015) 與 social-post-service (3012, STRATEGY=mock)。

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
    assert.strictEqual(publishData.mocked, true, 'translator 應標示這是下游 mock 任務');
    assert.strictEqual(publishData.mode, 'mock', 'translator 應把 Demo 模式轉發為 mode=mock');
    assert.ok(publishData.jobId, '回應應包含下游微服務 jobId');
    console.log(`✅ 成功透過 social-post-service 建立模擬任務。Job ID: ${publishData.jobId}`);

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
    console.log('（若 social-post-service 使用 mock strategy，Live 模式應被下游明確拒絕；若已配置真實 strategy，則可回傳 202）');

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

    // 若 microservice 使用 mock strategy 或離線，應回傳 503；若已配置真實 strategy，應回傳 202。
    if (livePublishRes.status === 503) {
      const errData = await livePublishRes.json();
      assert.ok(
        errData.error.includes('無法連線至社交發佈微服務') || errData.error.includes('Live 發佈需要真實平台 strategy'),
        '應該包含連線失敗或 live strategy 不存在的錯誤資訊'
      );
      console.log('✅ 驗證成功：Live 模式無法真實發佈時，系統正確返回 503，拒絕偽裝成功！');
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
