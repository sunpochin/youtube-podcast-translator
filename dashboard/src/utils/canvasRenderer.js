// dashboard/src/utils/canvasRenderer.js
// 負責在背景渲染 9:16 的 Instagram Story 分享圖卡（純 Canvas 繪製，無外部依賴）

/**
 * 繪製圓角矩形邊框
 */
function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/**
 * 多行文字自動折行
 */
function drawWrapText(ctx, text, x, y, maxWidth, lineHeight) {
  // 正則拆分：單個中文/日/韓字元、完整的英文單字/數值、以及其他標點/空白
  const tokens = text.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9']+|[^\u4e00-\u9fa5a-zA-Z0-9']/g) || []
  let line = ''
  let currentY = y
  const maxLines = 4
  let lineCount = 0

  for (let n = 0; n < tokens.length; n++) {
    const token = tokens[n]
    const testLine = line + token
    const metrics = ctx.measureText(testLine)
    const testWidth = metrics.width
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY)
      line = token
      currentY += lineHeight
      lineCount++
      if (lineCount >= maxLines - 1) {
        ctx.fillText(line + '...', x, currentY)
        return
      }
    } else {
      line = testLine
    }
  }
  ctx.fillText(line, x, currentY)
}

/**
 * 渲染分享圖卡並回傳 base64 PNG 資料
 * @param {string} title - 影片/文章標題
 * @param {string} publishUrl - GitBook 發佈後的對照閱讀網址
 * @returns {Promise<string>} - Promise 解析為 base64 圖片資料
 */
/**
 * 繪製 QR Code 離線或超時的降級佔位圖
 */
function drawFallbackPlaceholder(ctx, canvas, resolve, reject, isTimeout = false) {
  // 離線降級處理：當外部 QR Code 服務不可用時，繪製精美的替代佔位圖，而非中斷流程
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.strokeStyle = 'rgba(29, 185, 84, 0.4)'
  ctx.lineWidth = 4
  drawRoundRect(ctx, 380, 930, 320, 320, 24)
  ctx.fill()
  ctx.stroke()

  // 繪製連結與警告 Emoji
  ctx.fillStyle = '#1DB954'
  ctx.font = 'bold 70px system-ui, -apple-system, sans-serif'
  ctx.fillText('🔗', 540, 1070)

  ctx.fillStyle = '#a7a7a7'
  ctx.font = 'bold 24px system-ui, -apple-system, sans-serif'
  ctx.fillText('掃描連結閱讀', 540, 1145)

  ctx.fillStyle = '#888888'
  ctx.font = '18px system-ui, -apple-system, sans-serif'
  ctx.fillText(isTimeout ? '(QR 載入逾時)' : '(QR 服務離線)', 540, 1185)

  // 仍繪製底部提示文字，確保排版完整
  ctx.fillStyle = '#a7a7a7'
  ctx.font = '34px system-ui, -apple-system, sans-serif'
  ctx.fillText('長按或截圖掃碼，閱讀中英雙語對照筆記', 540, 1320)

  ctx.fillStyle = '#1DB954'
  ctx.font = 'bold 38px system-ui, -apple-system, sans-serif'
  ctx.fillText('SCAN TO READ', 540, 1395)

  try {
    const base64Data = canvas.toDataURL('image/png')
    resolve(base64Data)
  } catch (err) {
    reject(new Error(`導出失敗 (Tainted Canvas)：${err.message}`))
  }
}

/**
 * 渲染分享圖卡並回傳 base64 PNG 資料
 * @param {string} title - 影片/文章標題
 * @param {string} publishUrl - GitBook 發佈後的對照閱讀網址
 * @returns {Promise<string>} - Promise 解析為 base64 圖片資料
 */
export async function generateShareCard(title, publishUrl) {
  return new Promise((resolve, reject) => {
    // 建立背景畫布
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 1920
    const ctx = canvas.getContext('2d')

    // 繪製黑底漸層背景
    const grad = ctx.createLinearGradient(0, 0, 0, 1920)
    grad.addColorStop(0, '#0a0a0a')
    grad.addColorStop(1, '#181818')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 1080, 1920)

    // 繪製頂部發光圓形 (Spotify 綠色調)
    ctx.fillStyle = 'rgba(29, 185, 84, 0.15)'
    ctx.beginPath()
    ctx.arc(540, 200, 400, 0, Math.PI * 2)
    ctx.fill()

    // 繪製圓角毛玻璃質感主卡片
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 4
    drawRoundRect(ctx, 90, 250, 900, 1420, 40)
    ctx.fill()
    ctx.stroke()

    // 繪製麥克風 Emoji
    ctx.fillStyle = '#1DB954'
    ctx.font = 'bold 70px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('🎙️', 540, 390)

    // 繪製主標題
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 46px system-ui, -apple-system, sans-serif'
    drawWrapText(ctx, title || 'Podcast 翻譯筆記', 540, 485, 720, 68)

    // 繪製分隔裝飾線
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(180, 780)
    ctx.lineTo(900, 780)
    ctx.stroke()

    // 繪製社交舞標題背景字
    ctx.fillStyle = '#1DB954'
    ctx.font = 'bold 34px system-ui, -apple-system, sans-serif'
    ctx.fillText('Salsa & Bachata Social Dancing', 540, 850)

    // 載入與繪製跨域安全 QR Code
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(publishUrl)}`
    const qrImage = new Image()
    qrImage.crossOrigin = 'anonymous'

    // 設定 8 秒超時，防止 QR Code 生成服務掛起時讓 Promise 永久掛起
    const timeoutId = setTimeout(() => {
      qrImage.onload = null
      qrImage.onerror = null
      console.warn('[Canvas] QR Code 載入逾時，啟動降級佔位圖機制。')
      drawFallbackPlaceholder(ctx, canvas, resolve, reject, true)
    }, 8000)

    qrImage.onload = () => {
      clearTimeout(timeoutId)
      // 繪製成功載入的 QR Code
      ctx.drawImage(qrImage, 380, 930, 320, 320)

      // 繪製底部提示文字
      ctx.fillStyle = '#a7a7a7'
      ctx.font = '34px system-ui, -apple-system, sans-serif'
      ctx.fillText('長按或截圖掃碼，閱讀中英雙語對照筆記', 540, 1320)

      ctx.fillStyle = '#1DB954'
      ctx.font = 'bold 38px system-ui, -apple-system, sans-serif'
      ctx.fillText('SCAN TO READ', 540, 1395)

      // 導出 base64 圖片內容
      try {
        const base64Data = canvas.toDataURL('image/png')
        resolve(base64Data)
      } catch (err) {
        reject(new Error(`導出失敗 (Tainted Canvas)：${err.message}`))
      }
    }
    qrImage.onerror = () => {
      clearTimeout(timeoutId)
      console.warn('[Canvas] QR Code 載入錯誤，啟動降級佔位圖機制。')
      drawFallbackPlaceholder(ctx, canvas, resolve, reject, false)
    }
    qrImage.src = qrUrl
  })
}
