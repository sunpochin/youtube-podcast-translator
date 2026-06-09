// src/middleware/auth.js
// 安全授權與 IP 存取限制中間件

import rateLimit from 'express-rate-limit';

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'dancewithai';

// 判斷是否為本地開發請求的輔助函數
export function isLocalRequest(req) {
  // 測試專用：允許測試套件模擬來源 IP
  if (process.env.NODE_ENV === 'test' && req.headers?.['x-mock-ip']) {
    const mockIp = req.headers['x-mock-ip'];
    return mockIp.includes('127.0.0.1') || mockIp.includes('::1') || mockIp.includes('localhost');
  }
  const ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost');
}

// 授權中間件：僅限本機發佈至 GitBook
export function verifyGitBookPassword(req, res, next) {
  // 本地發佈允許
  if (isLocalRequest(req)) {
    return next();
  }

  return res.status(403).json({ error: '安全限制：僅限伺服器本機電腦之請求可以直接寫入 GitBook！' });
}

// IP 頻率限制 (每小時最多 2 次翻譯/發佈 API 呼叫，防範外部惡意洗流量)
export const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小時
  max: 2, // 每個 IP 限制 2 次
  message: { error: '此 IP 已達每小時最大翻譯額度 (2次/小時)，請稍候再試。' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // 開發者本地測試 (localhost) 跳過限制
    return isLocalRequest(req);
  }
});
