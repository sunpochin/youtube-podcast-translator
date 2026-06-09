// dashboard/src/App.jsx
// 主應用程式入口，處理狀態管理、API 連線、並協調整體 UI 組件排版

import { useState, useEffect } from 'react'
import { Play, Search, CheckCircle, AlertTriangle, FileText, Download, Sparkles, Clock } from 'lucide-react'
import QRCode from 'qrcode'
import { generateShareCard } from './utils/canvasRenderer'
import Header from './components/Header'
import ShareModal from './components/ShareModal'
import TranscriptPanel from './components/TranscriptPanel'

// 輔助函數：將秒數格式化為 mm:ss
function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function App() {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // 逐字稿狀態與翻譯狀態
  const [videoId, setVideoId] = useState(null)
  const [videoTitle, setVideoTitle] = useState('') // 影片原始標題
  const [transcript, setTranscript] = useState([])
  const [summary, setSummary] = useState('')
  const [translatedParagraphs, setTranslatedParagraphs] = useState([])
  const [translationProgress, setTranslationProgress] = useState(0) // 翻譯進度百分比
  
  const [isTranslating, setIsTranslating] = useState(false)
  const [activeTab, setActiveTab] = useState('full') // 'full' | 'summary'
  const [queueStatus, setQueueStatus] = useState(null) // { status: 'waiting' | 'running', position: number, currentTitle: string }

  // 密碼與引擎選擇狀態
  const [password, setPassword] = useState('')
  const [translationMode, setTranslationMode] = useState('ollama') // 'ollama' | 'gemini'
  const [isLocal, setIsLocal] = useState(false) // 默認非本地請求

  // GitBook 發佈狀態與自訂標題
  const [publishTitle, setPublishTitle] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishMessage, setPublishMessage] = useState(null)

  // 社交分享與 IG Story 卡片狀態
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharingToMicroservice, setSharingToMicroservice] = useState(false)
  const [socialShareMessage, setSocialShareMessage] = useState(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const [mockMode, setMockMode] = useState(true) // 預設使用模擬模式以利面試展示與 Demo
  const [pollingStatus, setPollingStatus] = useState(null) // 'queued' | 'posting' | 'completed' | 'failed'
  const [qrPreviewDataUrl, setQrPreviewDataUrl] = useState(null)
  const [shareMode, setShareMode] = useState('semi_auto') // 分享模式：'auto' | 'semi_auto' | 'keyword'
  const [customShortUrl, setCustomShortUrl] = useState('') // 自訂短網址
  const [keyword, setKeyword] = useState('文章') // 私訊回覆關鍵字

  // 初始化時檢測是否為本地連線
  useEffect(() => {
    fetch('/api/connection-check')
      .then(res => res.json())
      .then(data => setIsLocal(data.isLocal))
      .catch(err => console.error("檢測連線類型失敗", err))
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!publishMessage?.url) {
      setQrPreviewDataUrl(null)
      return
    }

    QRCode.toDataURL(publishMessage.url, {
      width: 150,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0a0a0a',
        light: '#ffffff'
      }
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrPreviewDataUrl(dataUrl)
        }
      })
      .catch((err) => {
        console.error('本地 QR Code 預覽生成失敗', err)
        if (!cancelled) {
          setQrPreviewDataUrl(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [publishMessage?.url])

  // 1. 抓取英文字幕
  const handleFetchTranscript = async (e) => {
    e.preventDefault()
    if (!youtubeUrl) return
    
    setLoading(true)
    setError(null)
    setVideoId(null)
    setTranscript([])
    setSummary('')
    setTranslatedParagraphs([])
    setVideoTitle('') // 重設影片標題
    setTranslationProgress(0) // 重設進度
    setPublishTitle('')
    setPublishMessage(null)
    
    try {
      const res = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl })
      })
      const data = await res.json()
      if (res.ok) {
        setVideoId(data.videoId)
        setTranscript(data.transcript)
        setVideoTitle(data.title || '') // 儲存影片原始標題
      } else {
        setError(data.error || '無法取得字幕')
      }
    } catch (err) {
      setError('與伺服器連線失敗')
    } finally {
      setLoading(false)
    }
  }

  // 2. 呼叫 Gemini 進行中英翻譯與大綱生成 (透過 SSE 串流)
  const handleTranslate = async () => {
    if (transcript.length === 0 || !videoId) return
    
    setIsTranslating(true)
    setError(null)
    setPublishMessage(null)
    setTranslationProgress(0)
    setTranslatedParagraphs([])
    setSummary('')
    setQueueStatus(null)
    
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          transcript, 
          videoId,
          password,
          mode: translationMode,
          title: videoTitle // 傳送影片原始標題給後端翻譯
        })
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || '翻譯請求失敗')
      }

      // 逐步讀取 SSE 串流資料
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let receivedParagraphs = []

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const cleanedLine = line.trim()
          if (cleanedLine.startsWith('data: ')) {
            try {
              const packet = JSON.parse(cleanedLine.substring(6))
              if (packet.type === 'queue_waiting') {
                setQueueStatus({
                  status: 'waiting',
                  position: packet.position,
                  currentTitle: packet.currentTitle
                })
              } else if (packet.type === 'queue_start') {
                setQueueStatus({ status: 'running' })
              } else if (packet.type === 'chunk') {
                receivedParagraphs = [...receivedParagraphs, packet.chunk]
                setTranslatedParagraphs(receivedParagraphs)
                setTranslationProgress(packet.progress)
              } else if (packet.type === 'summary') {
                setSummary(packet.summary)
              } else if (packet.type === 'error') {
                throw new Error(packet.error || '翻譯中途發生錯誤')
              } else if (packet.type === 'done') {
                // 收到完成事件，更新標題並切換 Tab
                setPublishTitle(packet.defaultTitle || `Podcast 翻譯 - 影片 ${videoId}`)
                setActiveTab('summary')
              }
            } catch (jsonErr) {
              console.error('解析串流資料失敗:', jsonErr)
              setError(jsonErr.message || '解析串流時發生錯誤')
            }
          }
        }
      }
    } catch (err) {
      console.error('翻譯失敗:', err)
      setError(err.message || 'AI 翻譯連線中斷，請重試')
    } finally {
      setIsTranslating(false)
      setQueueStatus(null)
    }
  }

  // 3. 發佈到 GitBook
  const handlePublishToGitBook = async () => {
    if (translatedParagraphs.length === 0 || !videoId || !publishTitle) return
    
    setIsPublishing(true)
    setPublishMessage(null)
    setError(null)

    try {
      const res = await fetch('/api/gitbook/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          summary,
          translatedParagraphs,
          title: publishTitle,
          password
        })
      })
      const data = await res.json()
      if (res.ok) {
        // 成功發佈時，儲存訊息與直達連結
        setPublishMessage({ success: true, text: data.message, url: data.url })
        setShowShareModal(true) // 顯示限動分享卡片面板！
      } else {
        setPublishMessage({ success: false, text: data.error || '發佈失敗' })
      }
    } catch (err) {
      setPublishMessage({ success: false, text: '無法連線至發佈伺服器' })
    } finally {
      setIsPublishing(false)
    }
  }

  // 一鍵匯出為 Markdown 對照筆記
  const exportMarkdown = () => {
    if (translatedParagraphs.length === 0) return
    
    let content = `# YouTube Podcast 導讀筆記\n\n`
    content += `> 影片連結: [YouTube 網頁連結 (新分頁開啟)](https://www.youtube.com/watch?v=${videoId})\n\n`
    content += `### 影片嵌入觀看 (可邊放邊對照)\n`
    content += `{% embed url="https://www.youtube.com/watch?v=${videoId}" %}\n\n`
    if (summary) {
      content += `## 核心主旨與關鍵看點\n\n${summary}\n\n`
    }
    content += `## 中英雙語逐字稿對照\n\n`
    translatedParagraphs.forEach(p => {
      content += `### [${formatTime(p.start)} - ${formatTime(p.end)}]\n`
      content += `**英文原文**:\n${p.english}\n\n`
      content += `**中文對照**:\n${p.chinese}\n\n`
      content += `---\n\n`
    })

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `podcast-notes-${videoId}.md`
    link.click()
  }

  // 輔助函數：將 Base64 轉換為 File 物件以進行原生分享
  const base64ToFile = async (base64Url, filename) => {
    const res = await fetch(base64Url)
    const blob = await res.blob()
    return new File([blob], filename, { type: 'image/png' })
  }

  // 呼叫手機/裝置原生分享系統發佈圖卡到社群 (如 IG Story)
  const handleNativeShare = async () => {
    if (!publishMessage?.url || !videoId) return

    try {
      const base64Image = await generateShareCard(
        publishTitle || videoTitle || 'Podcast 翻譯筆記',
        publishMessage.url,
        { shareMode, keyword, shortUrl: customShortUrl }
      )
      const file = await base64ToFile(base64Image, `podcast-share-${videoId}.png`)

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `分享 Podcast 翻譯筆記：《${publishTitle || videoTitle}》`,
          text: `我剛翻譯了一篇雙人社交舞 Podcast 筆記！閱讀全文：${publishMessage.url}`
        })
      } else {
        // 不支援原生檔案分享時，直接降級為下載圖片
        await handleDownloadImage()
      }
    } catch (err) {
      if (err.name === 'AbortError') return // 使用者主動取消分享，直接忽略
      console.warn("裝置不支援原生分享或發生異常，降級至一般下載模式:", err.message)
      await handleDownloadImage()
    }
  }

  // 渲染限動分享卡片並觸發瀏覽器下載
  const handleDownloadImage = async () => {
    if (!publishMessage?.url) return

    try {
      const base64Data = await generateShareCard(
        publishTitle || videoTitle || 'Podcast 翻譯筆記',
        publishMessage.url,
        { shareMode, keyword, shortUrl: customShortUrl }
      )
      const link = document.createElement('a')
      link.download = `podcast-share-${videoId}.png`
      link.href = base64Data
      link.click()
    } catch (err) {
      console.error('下載圖卡失敗:', err)
      setError('無法渲染或下載分享圖卡')
    }
  }

  // 輪詢微服務發佈任務狀態
  const startPollingJobStatus = (jobId) => {
    let attempts = 0
    setPollingStatus('queued')
    const interval = setInterval(async () => {
      attempts++
      try {
        const res = await fetch(`/api/social/status/${jobId}`)
        if (res.ok) {
          const job = await res.json()
          setPollingStatus(job.status)
          
          if (job.status === 'completed') {
            clearInterval(interval)
            setSharingToMicroservice(false)
            setSocialShareMessage({
              success: true,
              text: mockMode
                ? `🎉 發佈成功！(模擬任務已順利完成)`
                : `🎉 發佈成功！已發佈至 Instagram (Post ID: ${job.results?.[0]?.platformPostId || 'N/A'})`
            })
          } else if (job.status === 'failed') {
            clearInterval(interval)
            setSharingToMicroservice(false)
            setSocialShareMessage({
              success: false,
              text: `❌ 發佈失敗: ${job.results?.[0]?.error || '微服務執行錯誤'}`
            })
          }
        } else {
          // 處理異常狀態碼
          if (attempts > 12) {
            clearInterval(interval)
            setSharingToMicroservice(false)
            setPollingStatus('failed')
            setSocialShareMessage({ success: false, text: '⚠️ 查詢任務狀態超時' })
          }
        }
      } catch (err) {
        if (attempts > 12) {
          clearInterval(interval)
          setSharingToMicroservice(false)
          setPollingStatus('failed')
          setSocialShareMessage({ success: false, text: '⚠️ 狀態查詢連線失敗' })
        }
      }
    }, 1500)
  }

  // 渲染卡片並同步發送至社交發佈微服務 (social-post-service)
  const handleShareToMicroservice = async () => {
    if (!publishMessage?.url || !videoId) return

    setSharingToMicroservice(true)
    setSocialShareMessage(null)
    setPollingStatus('queued')

    try {
      const base64Image = await generateShareCard(
        publishTitle || videoTitle || 'Podcast 翻譯筆記',
        publishMessage.url,
        { shareMode, keyword, shortUrl: customShortUrl }
      )

      const res = await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: publishTitle || videoTitle || 'Podcast 翻譯筆記',
          url: publishMessage.url,
          image: base64Image,
          mockMode
        })
      })

      const data = await res.json()
      if (res.ok) {
        setSocialShareMessage({
          success: true,
          text: data.mocked 
            ? `💡 已建立模擬任務 (Job ID: ${data.jobId})，正在模擬發佈進度...` 
            : `✅ 已成功遞交！正在追蹤任務發佈進度 (Job ID: ${data.jobId})...`
        })
        startPollingJobStatus(data.jobId)
      } else {
        setSocialShareMessage({ success: false, text: data.error || '微服務發佈失敗' })
        setSharingToMicroservice(false)
        setPollingStatus(null)
      }
    } catch (err) {
      setSocialShareMessage({ success: false, text: '連線或渲染微服務圖卡失敗' })
      setSharingToMicroservice(false)
      setPollingStatus(null)
    }
  }

  // 複製網址到剪貼簿的輔助函數 (相容非安全/HTTP 上下文)
  const handleCopyLink = () => {
    if (!publishMessage?.url) return
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // 優先使用現代安全 API
      navigator.clipboard.writeText(publishMessage.url)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } else {
      // 降級退化方案：建立臨時 textarea 進行複製
      const textArea = document.createElement('textarea')
      textArea.value = publishMessage.url
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px' // 移出可視區
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        const successful = document.execCommand('copy')
        if (successful) {
          setCopiedLink(true)
          setTimeout(() => setCopiedLink(false), 2000)
        } else {
          console.warn('Fallback copy command returned false')
        }
      } catch (err) {
        console.error('Fallback copy failed', err)
      }
      document.body.removeChild(textArea)
    }
  }

  return (
    <div className="min-h-screen bg-spotify-dark text-white flex flex-col selection:bg-spotify-green selection:text-black">
      <Header />

      {/* 主內容區 */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        
        {/* 網址輸入面板 */}
        <section className="bg-spotify-card border border-white/5 p-6 rounded-2xl shadow-xl backdrop-blur-lg">
          <h2 className="text-lg font-semibold mb-4 text-white">1. 輸入 YouTube Podcast 網址</h2>
          <form onSubmit={handleFetchTranscript} className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-white/40">
                <Search size={18} />
              </div>
              <input
                type="url"
                placeholder="請貼上 YouTube 影片連結 (例如: https://www.youtube.com/watch?v=...)"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-spotify-green focus:ring-1 focus:ring-spotify-green transition-all"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-spotify-green hover:bg-spotify-green/90 text-black font-semibold px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent"></div>
                  <span>抓取字幕中...</span>
                </>
              ) : (
                <>
                  <FileText size={18} />
                  <span>抓取字幕</span>
                </>
              )}
            </button>
          </form>

          {/* 引擎模式選擇 (僅在本地連線時顯示，外部瀏覽時直接隱藏) */}
          {isLocal && (
            <div className="flex flex-col gap-1.5 text-left mt-4 pt-4 border-t border-white/5 max-w-xs">
              <label className="text-xs font-semibold text-spotify-text">翻譯大腦引擎</label>
              <div className="flex gap-2 p-1 bg-black/40 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => setTranslationMode('ollama')}
                  className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${translationMode === 'ollama' ? 'bg-spotify-green text-black' : 'text-spotify-text hover:text-white'}`}
                >
                  本地 Ollama (免費/預設)
                </button>
                <button
                  type="button"
                  onClick={() => setTranslationMode('gemini')}
                  className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${translationMode === 'gemini' ? 'bg-gradient-to-r from-violet-500 to-indigo-500 text-white font-bold' : 'text-spotify-text hover:text-white'}`}
                >
                  雲端 Gemini (高品質/付費)
                </button>
              </div>
            </div>
          )}

          {/* 錯誤提示 */}
          {error && (
            <div className="mt-4 p-4 bg-red-950/40 border border-red-500/30 rounded-xl flex items-start gap-3 text-red-400 text-sm">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}
        </section>

        {/* 逐字稿顯示面板 */}
        {videoId && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 items-stretch">
            
            {/* 左邊：影片預覽與翻譯觸發控制 */}
            <div className="lg:col-span-1 flex flex-col gap-6">
              <div className="bg-spotify-card border border-white/5 rounded-2xl overflow-hidden shadow-lg flex flex-col">
                <div className="aspect-video relative bg-black">
                  <iframe
                    className="absolute inset-0 w-full h-full"
                    src={`https://www.youtube.com/embed/${videoId}`}
                    title="YouTube video player"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  ></iframe>
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/95 mb-3">
                      <Clock size={12} />
                      長度: {transcript.length > 0 ? formatTime(transcript[transcript.length - 1].start) : '0:00'}
                    </span>
                    <h3 className="font-semibold text-base text-white/90">{videoTitle || '字幕抓取成功！'}</h3>
                    <p className="text-sm text-spotify-text mt-1">
                      共抓取到 {transcript.length} 段字幕片段。現在可以使用 Gemini 將其翻譯為繁體中文對照，並分析核心大綱。
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-white/5">
                    {translatedParagraphs.length === 0 || isTranslating ? (
                      <div className="flex flex-col gap-3">
                        {/* 排隊狀態顯示器 */}
                        {queueStatus && queueStatus.status === 'waiting' && (
                          <div className="bg-amber-950/40 border border-amber-500/30 text-amber-400 p-4 rounded-xl text-sm text-left flex flex-col gap-1.5 animate-pulse">
                            <div className="font-semibold flex items-center gap-1.5">
                              <Clock size={16} />
                              <span>📞 客服語音：前方有任務正在處理</span>
                            </div>
                            <div className="text-xs leading-relaxed text-amber-300/90">
                              當前處理中：<span className="text-white font-medium line-clamp-1">{queueStatus.currentTitle}</span>
                              您目前排在第 <strong className="text-white font-bold text-sm bg-white/10 px-1.5 py-0.5 rounded">{queueStatus.position}</strong> 位，請稍候，完成後將自動開始您的翻譯...
                            </div>
                          </div>
                        )}

                        {queueStatus && queueStatus.status === 'running' && (
                          <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 p-4 rounded-xl text-sm text-left flex flex-col gap-1.5">
                            <div className="font-semibold flex items-center gap-1.5">
                              <Sparkles size={16} className="animate-pulse text-spotify-green" />
                              <span>🎉 輪到你了！正在啟動翻譯服務...</span>
                            </div>
                          </div>
                        )}

                        {isTranslating && (!queueStatus || queueStatus.status === 'running') && (
                          <div className="w-full text-left">
                            <div className="flex justify-between text-xs text-spotify-text mb-1.5">
                              <span>翻譯進度</span>
                              <span>{translationProgress}%</span>
                            </div>
                            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                              <div 
                                className="bg-spotify-green h-full transition-all duration-300"
                                style={{ width: `${translationProgress}%` }}
                              ></div>
                            </div>
                          </div>
                        )}
                        <button
                          onClick={handleTranslate}
                          disabled={isTranslating}
                          className="w-full bg-gradient-to-r from-spotify-green to-emerald-500 hover:from-spotify-green/90 hover:to-emerald-500/90 text-black font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-50"
                        >
                          {isTranslating ? (
                            <>
                              <div className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent"></div>
                              <span>
                                {queueStatus && queueStatus.status === 'waiting' 
                                  ? `排隊中 (第 ${queueStatus.position} 位)...` 
                                  : `AI 雙語對照翻譯中... (${translationProgress}%)`}
                              </span>
                            </>
                          ) : (
                            <>
                              <Sparkles size={18} />
                              <span>啟動 AI 雙語翻譯</span>
                            </>
                          )}
                        </button>
                      </div>
                     ) : (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2 text-spotify-green text-sm">
                          <CheckCircle size={16} />
                          <span>AI 雙語翻譯完成！</span>
                        </div>
                        <button
                          onClick={exportMarkdown}
                          className="w-full bg-white/10 hover:bg-white/15 text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all border border-white/5"
                        >
                          <Download size={18} />
                          <span>匯出 Markdown 筆記</span>
                        </button>
                        
                        {/* GitBook 發佈區塊：僅在本地連線時顯示，防止外部用戶隨意寫入 GitBook 知識庫 */}
                        {isLocal && (
                          <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-2">
                            <span className="text-xs font-semibold text-spotify-text text-left">2. 發佈到 GitBook (Social Dance Notes)</span>
                            <input
                              type="text"
                              placeholder="輸入 GitBook 目錄標題..."
                              value={publishTitle}
                              onChange={(e) => setPublishTitle(e.target.value)}
                              className="w-full px-3 py-2 bg-black/60 border border-white/15 rounded-lg text-sm placeholder:text-white/20 focus:outline-none focus:border-spotify-green"
                            />
                            <button
                              onClick={handlePublishToGitBook}
                              disabled={isPublishing || !publishTitle}
                              className="w-full bg-spotify-green text-black hover:bg-spotify-green/90 font-bold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
                            >
                              {isPublishing ? (
                                  <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></div>
                                    <span>發佈中...</span>
                                  </>
                                ) : (
                                  <>
                                    <Sparkles size={16} />
                                    <span>發佈到 GitBook</span>
                                  </>
                                )}
                            </button>
                            
                            {publishMessage && (
                              <div className={`mt-2 p-3 rounded-lg text-xs border text-left ${publishMessage.success ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400' : 'bg-red-950/40 border-red-500/30 text-red-400'}`}>
                                <div className="font-semibold">{publishMessage.text}</div>
                                {publishMessage.success && publishMessage.url && (
                                  <a 
                                    href={publishMessage.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="mt-2 block font-bold text-spotify-green hover:underline cursor-pointer"
                                  >
                                    👉 點此直接打開 GitBook 頁面
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 右邊：大綱與逐字稿雙欄對照閱讀器 */}
            <TranscriptPanel
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              translatedParagraphs={translatedParagraphs}
              transcript={transcript}
              summary={summary}
            />

          </div>
        )}

      {/* 🚀 IG 限動卡片與微服務分享彈窗 */}
      <ShareModal
        show={showShareModal}
        onClose={() => {
          setShowShareModal(false)
          setSocialShareMessage(null)
          setPollingStatus(null)
        }}
        publishMessage={publishMessage}
        publishTitle={publishTitle}
        videoTitle={videoTitle}
        qrPreviewDataUrl={qrPreviewDataUrl}
        shareMode={shareMode}
        setShareMode={setShareMode}
        customShortUrl={customShortUrl}
        setCustomShortUrl={setCustomShortUrl}
        keyword={keyword}
        setKeyword={setKeyword}
        mockMode={mockMode}
        setMockMode={setMockMode}
        sharingToMicroservice={sharingToMicroservice}
        pollingStatus={pollingStatus}
        socialShareMessage={socialShareMessage}
        handleCopyLink={handleCopyLink}
        copiedLink={copiedLink}
        handleNativeShare={handleNativeShare}
        handleShareToMicroservice={handleShareToMicroservice}
      />
      </main>
    </div>
  )
}

export default App
