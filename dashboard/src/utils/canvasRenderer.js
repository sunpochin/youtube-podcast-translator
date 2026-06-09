// dashboard/src/utils/canvasRenderer.js
// 負責在背景渲染 9:16 的 Instagram Story 分享圖卡（純 Canvas 繪製，二維碼本地生成）

import QRCode from 'qrcode'

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
 * 繪製 QR Code 離線或超時的降級佔位圖
 */
function drawFallbackPlaceholder(ctx, canvas, resolve, reject, options = {}, isTimeout = false) {
  const { shortUrl = '', publishUrl = '' } = options

  // 離線降級處理：繪製精美的替代佔位圖，避免顯示空白
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.strokeStyle = 'rgba(29, 185, 84, 0.4)'
  ctx.lineWidth = 4
  drawRoundRect(ctx, 340, 960, 400, 400, 24)
  ctx.fill()
  ctx.stroke()

  // 繪製連結符號與提示
  ctx.fillStyle = '#1DB954'
  ctx.font = 'bold 80px system-ui, -apple-system, sans-serif'
  ctx.fillText('🔗', 540, 1120)

  ctx.fillStyle = '#a7a7a7'
  ctx.font = 'bold 26px system-ui, -apple-system, sans-serif'
  ctx.fillText('掃描連結閱讀', 540, 1210)

  ctx.fillStyle = '#888888'
  ctx.font = '20px system-ui, -apple-system, sans-serif'
  ctx.fillText(isTimeout ? '(QR 載入逾時)' : '(QR 服務離線)', 540, 1255)

  // 繪製頂部手機看截圖說明
  ctx.fillStyle = '#a7a7a7'
  ctx.font = '32px system-ui, -apple-system, sans-serif'
  ctx.fillText('👇 手機看請截圖，再長按 QR code', 540, 910)

  // 繪製短網址
  const displayUrl = shortUrl || publishUrl.replace(/^https?:\/\//, '').replace(/^www\./, '')
  let urlText = displayUrl
  if (urlText.length > 40) {
    urlText = urlText.substring(0, 37) + '...'
  }
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 34px system-ui, -apple-system, sans-serif'
  ctx.fillText(`或輸入：${urlText}`, 540, 1420)

  ctx.fillStyle = '#1DB954'
  ctx.font = 'bold 38px system-ui, -apple-system, sans-serif'
  ctx.fillText('SCAN / SCREENSHOT TO READ', 540, 1485)

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
 * @param {object} options - 分享模式設定（如 A/B/C 模式與自訂字串）
 * @returns {Promise<string>} - Promise 解析為 base64 圖片資料
 */
export async function generateShareCard(title, publishUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const { shareMode = 'semi_auto', keyword = '文章', shortUrl = '' } = options

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

    if (shareMode === 'keyword') {
      // 繪製 Mode C 的回覆關鍵字卡片 layout
      ctx.fillStyle = 'rgba(29, 185, 84, 0.08)'
      ctx.strokeStyle = 'rgba(29, 185, 84, 0.3)'
      ctx.lineWidth = 4
      drawRoundRect(ctx, 240, 960, 600, 360, 30)
      ctx.fill()
      ctx.stroke()

      // 繪製引導文字
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 38px system-ui, -apple-system, sans-serif'
      ctx.fillText('💬 想要閱讀全文？', 540, 1030)

      ctx.fillStyle = '#a7a7a7'
      ctx.font = '30px system-ui, -apple-system, sans-serif'
      ctx.fillText('在下方回覆或私訊：', 540, 1105)

      ctx.fillStyle = '#1DB954'
      ctx.font = 'bold 56px system-ui, -apple-system, sans-serif'
      ctx.fillText(`「${keyword}」`, 540, 1195)

      ctx.fillStyle = '#a7a7a7'
      ctx.font = '30px system-ui, -apple-system, sans-serif'
      ctx.fillText('我會自動傳送連結給您！', 540, 1270)

      // 繪製短網址與英文標題
      const displayUrl = shortUrl || publishUrl.replace(/^https?:\/\//, '').replace(/^www\./, '')
      let urlText = displayUrl
      if (urlText.length > 40) {
        urlText = urlText.substring(0, 37) + '...'
      }
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 34px system-ui, -apple-system, sans-serif'
      ctx.fillText(`或手動輸入：${urlText}`, 540, 1420)

      ctx.fillStyle = '#1DB954'
      ctx.font = 'bold 38px system-ui, -apple-system, sans-serif'
      ctx.fillText('REPLY TO GET THE LINK', 540, 1485)

      // 直接輸出 base64 PNG 圖片，不需載入二維碼
      try {
        const base64Data = canvas.toDataURL('image/png')
        resolve(base64Data)
      } catch (err) {
        reject(new Error(`導出失敗 (Tainted Canvas)：${err.message}`))
      }
    } else {
      // 繪製手機看截圖說明
      ctx.fillStyle = '#a7a7a7'
      ctx.font = '32px system-ui, -apple-system, sans-serif'
      ctx.fillText('👇 手機看請截圖，再長按 QR code', 540, 910)

      // 使用本地 qrcode 模組直接生成 QR code 避免依賴外部 API
      const qrImage = new Image()
      QRCode.toDataURL(publishUrl, {
        width: 400,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#0a0a0a',
          light: '#ffffff'
        }
      })
      .then((qrDataUrl) => {
        qrImage.onload = () => {
          // 繪製本地生成的二維碼 (400x400)
          ctx.drawImage(qrImage, 340, 960, 400, 400)

          // 繪製短網址
          const displayUrl = shortUrl || publishUrl.replace(/^https?:\/\//, '').replace(/^www\./, '')
          let urlText = displayUrl
          if (urlText.length > 40) {
            urlText = urlText.substring(0, 37) + '...'
          }
          ctx.fillStyle = '#FFFFFF'
          ctx.font = 'bold 34px system-ui, -apple-system, sans-serif'
          ctx.fillText(`或輸入：${urlText}`, 540, 1420)

          ctx.fillStyle = '#1DB954'
          ctx.font = 'bold 38px system-ui, -apple-system, sans-serif'
          ctx.fillText('SCAN / SCREENSHOT TO READ', 540, 1485)

          // 導出 base64 圖片內容
          try {
            const base64Data = canvas.toDataURL('image/png')
            resolve(base64Data)
          } catch (err) {
            reject(new Error(`導出失敗 (Tainted Canvas)：${err.message}`))
          }
        }
        qrImage.src = qrDataUrl
      })
      .catch((err) => {
        console.warn('[Canvas] 本地 QR Code 生成失敗，啟動降級佔位圖機制。', err)
        drawFallbackPlaceholder(ctx, canvas, resolve, reject, { shortUrl, publishUrl }, false)
      })
    }
  })
}
