import { useState, useEffect } from 'react'
import { Play, Search, CheckCircle, AlertTriangle, FileText, Download, Sparkles, Languages, Clock } from 'lucide-react'
import QRCode from 'qrcode'
import { generateShareCard } from './utils/canvasRenderer'

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
    
    let content = `# YouTube Podcast 導讀筆記\\n\\n`
    content += `> 影片連結: [YouTube 網頁連結 (新分頁開啟)](https://www.youtube.com/watch?v=${videoId})\\n\\n`
    content += `### 影片嵌入觀看 (可邊放邊對照)\\n`
    content += `{% embed url="https://www.youtube.com/watch?v=${videoId}" %}\\n\\n`
    if (summary) {
      content += `## 核心主旨與關鍵看點\\n\\n${summary}\\n\\n`
    }
    content += `## 中英雙語逐字稿對照\\n\\n`
    translatedParagraphs.forEach(p => {
      content += `### [${formatTime(p.start)} - ${formatTime(p.end)}]\\n`
      content += `**英文原文**:\\n${p.english}\\n\\n`
      content += `**中文對照**:\\n${p.chinese}\\n\\n`
      content += `---\\n\\n`
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
      {/* 頂部導航列 */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-red-600 p-2 rounded-lg text-white">
              <Play size={24} fill="white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white m-0">Podcast 中文對照翻譯器</h1>
              <p className="text-xs text-spotify-text m-0">
                輸入 YouTube 連結，AI 導讀
                <del className="relative mx-1 inline-block no-underline opacity-70 after:absolute after:left-0 after:top-1/2 after:h-[1px] after:w-full after:-rotate-12 after:bg-current after:content-['']">
                  秒級
                </del>
                <ins className="no-underline font-medium">
                  小時級
                </ins>
                搞定
              </p>
            </div>
          </div>
          <div className="text-xs text-white/40 font-mono">
            Powered by Gemini 2.5 Flash
          </div>
        </div>
      </header>

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
            <div className="lg:col-span-2 flex flex-col bg-spotify-card border border-white/5 rounded-2xl overflow-hidden shadow-lg">
              
              {/* Tab 控制列 */}
              <div className="flex border-b border-white/10 bg-black/20 p-2">
                <button
                  onClick={() => setActiveTab('full')}
                  className={`flex-1 py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${activeTab === 'full' ? 'bg-white/10 text-white' : 'text-spotify-text hover:text-white'}`}
                >
                  <Languages size={16} />
                  <span>中英逐字對照</span>
                </button>
                {translatedParagraphs.length > 0 && (
                  <button
                    onClick={() => setActiveTab('summary')}
                    className={`flex-1 py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${activeTab === 'summary' ? 'bg-white/10 text-white' : 'text-spotify-text hover:text-white'}`}
                  >
                    <Sparkles size={16} />
                    <span>大綱與精華導讀</span>
                  </button>
                )}
              </div>

              {/* 內容展現區 */}
              <div className="flex-1 overflow-y-auto p-6 max-h-[600px]">
                
                {/* 1. 中英逐字對照面板 */}
                {activeTab === 'full' && (
                  <div className="space-y-6">
                    {translatedParagraphs.length > 0 ? (
                      // 顯示翻譯後的段落對照
                      translatedParagraphs.map((paragraph, index) => (
                        <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 border-b border-white/5 last:border-b-0 hover:bg-white/[0.01] p-3 rounded-xl transition-all">
                          {/* 英文段落 */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-mono text-spotify-green">
                              <Clock size={12} />
                              <span>{formatTime(paragraph.start)} - {formatTime(paragraph.end)}</span>
                            </div>
                            <p className="text-sm leading-relaxed text-white/90 font-light select-text">
                              {paragraph.english}
                            </p>
                          </div>
                          {/* 中文段落 */}
                          <div className="space-y-2 md:border-l md:border-white/5 md:pl-4">
                            <span className="text-xs font-semibold text-spotify-text">中文對照</span>
                            <p className="text-sm leading-relaxed text-spotify-green/90 font-normal select-text">
                              {paragraph.chinese}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      // 僅顯示抓取到的英文逐字稿 (未翻譯前)
                      <div className="space-y-4">
                        <div className="p-3 bg-white/5 rounded-xl text-sm text-spotify-text mb-4">
                          提示：以下為未翻譯之原始英文字幕。您可以點選左側「啟動 AI 雙語翻譯」獲取中英對照與大綱分析。
                        </div>
                        {transcript.map((item, index) => (
                          <div key={index} className="flex items-start gap-4 hover:bg-white/[0.02] p-2 rounded-lg transition-all">
                            <span className="text-xs font-mono text-white/40 shrink-0 mt-1">{formatTime(item.start)}</span>
                            <p className="text-sm text-white/80 select-text">{item.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. 大綱與精華導讀面板 */}
                {activeTab === 'summary' && summary && (
                  <div className="prose prose-invert max-w-none space-y-6">
                    <div className="bg-black/30 p-5 rounded-2xl border border-white/5">
                      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                        <Sparkles size={18} className="text-spotify-green" />
                        <span>AI 導讀精華摘要</span>
                      </h3>
                      {/* 以換行字元分割並輸出 */}
                      {summary.split('\\n').map((line, idx) => {
                        if (line.startsWith('#')) {
                          return <h4 key={idx} className="text-md font-semibold text-white mt-4 mb-2">{line.replace(/#/g, '').trim()}</h4>
                        }
                        if (line.startsWith('-') || line.startsWith('*')) {
                          return <li key={idx} className="text-sm text-spotify-text list-disc list-inside ml-2 py-0.5">{line.substring(1).trim()}</li>
                        }
                        return <p key={idx} className="text-sm text-spotify-text leading-relaxed py-1">{line}</p>
                      })}
                    </div>
                  </div>
                )}

              </div>
            </div>

          </div>
        )}
      {/* 🚀 IG 限動卡片與微服務分享彈窗 */}
      {showShareModal && publishMessage?.success && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-spotify-card border border-white/10 rounded-3xl max-w-md w-full p-6 shadow-2xl relative flex flex-col gap-5 my-8 animate-fade-in text-center">
            
            {/* 關閉按鈕 */}
            <button
              onClick={() => {
                setShowShareModal(false)
                setSocialShareMessage(null)
                setPollingStatus(null)
              }}
              className="absolute top-4 right-4 text-white/40 hover:text-white bg-white/5 hover:bg-white/10 p-1.5 rounded-full transition-all text-sm font-semibold"
            >
              ✕
            </button>

            <div>
              <h3 className="text-xl font-bold text-white flex items-center justify-center gap-2">
                <Sparkles className="text-spotify-green animate-pulse" size={20} />
                <span>發佈成功！產生成果卡片</span>
              </h3>
              <p className="text-xs text-spotify-text mt-1">
                下方為您的專屬 IG Story 9:16 分享美圖與掃描二維碼
              </p>
            </div>

            {/* 模式切換頁籤 */}
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 gap-1 select-none">
              <button
                onClick={() => setShareMode('semi_auto')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${shareMode === 'semi_auto' ? 'bg-spotify-green text-black' : 'text-gray-400 hover:text-white'}`}
              >
                🔥 半自動高轉換
              </button>
              <button
                onClick={() => setShareMode('auto')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${shareMode === 'auto' ? 'bg-spotify-green text-black' : 'text-gray-400 hover:text-white'}`}
              >
                📲 全自動
              </button>
              <button
                onClick={() => setShareMode('keyword')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${shareMode === 'keyword' ? 'bg-spotify-green text-black' : 'text-gray-400 hover:text-white'}`}
              >
                💬 關鍵字回覆
              </button>
            </div>

            {/* 卡片設定輸入框 */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-3 text-left">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">自訂圖卡短網址 (選填)：</label>
                <input
                  type="text"
                  placeholder={`預設: ${publishMessage.url.replace(/^https?:\/\//, '').replace(/^www\./, '').substring(0, 25)}...`}
                  value={customShortUrl}
                  onChange={(e) => setCustomShortUrl(e.target.value)}
                  className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-spotify-green/60"
                />
              </div>

              {shareMode === 'keyword' && (
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">私訊回覆關鍵字：</label>
                  <input
                    type="text"
                    placeholder="例如: 文章"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-spotify-green/60"
                  />
                </div>
              )}
            </div>

            {/* 玩法指引 */}
            <div className="text-xs text-left leading-relaxed p-3.5 rounded-2xl bg-spotify-green/10 border border-spotify-green/20 text-spotify-green flex flex-col gap-1">
              {shareMode === 'semi_auto' && (
                <>
                  <span className="font-bold text-white flex items-center gap-1.5">🔥 轉換率最高的推薦玩法：</span>
                  <span className="text-gray-300">1. 點擊下方<strong>「🔗 複製文章連結」</strong>按鈕。</span>
                  <span className="text-gray-300">2. 點擊<strong>「📲 一鍵分享至 IG 限動」</strong>下載特製 Story 圖卡。</span>
                  <span className="text-gray-300">3. 手動打開 IG 貼上圖卡，並用貼紙工具新增 <strong>Link sticker</strong> 貼上網址。</span>
                </>
              )}
              {shareMode === 'auto' && (
                <>
                  <span className="font-bold text-white flex items-center gap-1.5">📲 機器人全自動代發限動：</span>
                  <span className="text-gray-300">點擊<strong>「🚀 遞交至發佈微服務」</strong>，程式會把圖卡發上 IG。</span>
                  <span className="text-gray-300 text-[10px] text-amber-400 mt-1 leading-normal">⚠️ 提醒：因 IG API 限制，代發的限動<strong>不支援</strong>可點擊貼紙，受眾需掃 QR code 或手動輸入短網址。</span>
                </>
              )}
              {shareMode === 'keyword' && (
                <>
                  <span className="font-bold text-white flex items-center gap-1.5">💬 私訊自動回覆模式：</span>
                  <span className="text-gray-300">圖卡將印上引導受眾回覆<strong>「{keyword}」</strong>暗號的精美對話泡泡。</span>
                  <span className="text-gray-300">下載此圖卡發到 IG，受眾回覆限動即觸發自動回覆（如 ManyChat）傳送全文。</span>
                </>
              )}
            </div>

            {/* 卡片預覽 (9:16) */}
            <div className="aspect-[9/16] w-full max-w-[230px] mx-auto bg-gradient-to-b from-[#0a0a0a] to-[#181818] rounded-2xl border border-white/10 p-4 relative flex flex-col justify-between shadow-2xl overflow-hidden text-center shrink-0 select-none">
              {/* 發光裝飾背景 */}
              <div className="absolute top-[-50px] left-[-50px] w-64 h-64 bg-spotify-green/10 rounded-full filter blur-3xl pointer-events-none"></div>
              
              <div className="border border-white/5 bg-white/[0.03] rounded-xl p-3 flex-1 flex flex-col justify-between items-center text-center">
                <div className="text-xl mt-1">🎙️</div>
                <div className="text-[10px] font-bold line-clamp-3 leading-normal my-1 px-1 text-white/95">
                  {publishTitle || videoTitle || 'Podcast 翻譯筆記'}
                </div>
                <div className="w-12 border-t border-white/10 my-0.5"></div>
                <div className="text-[8px] text-spotify-green font-bold tracking-wider uppercase">
                  Salsa & Bachata Dance
                </div>
                
                {shareMode === 'keyword' ? (
                  // Mode C 氣泡預覽
                  <div className="w-full border border-spotify-green/20 bg-spotify-green/5 rounded-lg p-2 my-1.5 text-center flex flex-col justify-center items-center gap-0.5">
                    <div className="text-[9px] text-white/90 font-bold">💬 想要閱讀全文？</div>
                    <div className="text-[7px] text-white/50">在下方回覆或私訊：</div>
                    <div className="text-[12px] text-spotify-green font-extrabold my-0.5">「{keyword}」</div>
                    <div className="text-[7px] text-white/50">我會自動傳送連結給您！</div>
                  </div>
                ) : (
                  // Mode A & B QR 預覽
                  <>
                    <div className="text-[7px] text-white/40 mt-1.5">
                      👇 手機看請截圖，再長按 QR code
                    </div>
                    {qrPreviewDataUrl ? (
                      <img
                        src={qrPreviewDataUrl}
                        alt="QR Code"
                        className="w-20 h-20 bg-white p-1 rounded-lg shadow-md my-1.5"
                      />
                    ) : (
                      <div className="w-20 h-20 bg-white/10 border border-spotify-green/30 rounded-lg shadow-md my-1.5 flex items-center justify-center text-[7px] text-spotify-green font-bold leading-tight px-1">
                        QR 生成中
                      </div>
                    )}
                  </>
                )}
                
                <div className="text-[7px] text-white/40 leading-snug line-clamp-1">
                  {shareMode === 'keyword' ? '或手動輸入：' : '或輸入：'}
                  {customShortUrl || publishMessage.url.replace(/^https?:\/\//, '').replace(/^www\./, '')}
                </div>
                <div className="text-[7px] text-spotify-green font-bold mt-0.5 tracking-widest uppercase">
                  {shareMode === 'keyword' ? 'REPLY FOR LINK' : 'SCAN TO READ'}
                </div>
              </div>
            </div>

            {/* 微服務整合模式選擇器 */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-2 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-300">微服務整合模式：</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${mockMode ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                  {mockMode ? '模擬展示 (Demo)' : '實體微服務 (Live)'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => setMockMode(true)}
                  disabled={sharingToMicroservice}
                  className={`py-1.5 px-2 rounded-lg font-medium transition-all ${mockMode ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40' : 'bg-transparent text-gray-400 hover:text-white border border-transparent'}`}
                >
                  🎭 模擬展示
                </button>
                <button
                  onClick={() => setMockMode(false)}
                  disabled={sharingToMicroservice}
                  className={`py-1.5 px-2 rounded-lg font-medium transition-all ${!mockMode ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' : 'bg-transparent text-gray-400 hover:text-white border border-transparent'}`}
                >
                  ⚡ 實體微服務
                </button>
              </div>
            </div>

            {/* 控制按鈕組 */}
            <div className="flex flex-col gap-3">
              <button
                onClick={handleCopyLink}
                className="w-full bg-white/10 hover:bg-white/15 text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all border border-white/5 text-sm"
              >
                <span>{copiedLink ? '✓ 已複製連結！' : '🔗 複製文章連結'}</span>
              </button>
              
              <button
                onClick={handleNativeShare}
                className="w-full bg-spotify-green hover:bg-spotify-green/90 text-black font-bold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all text-sm"
              >
                <span>📲 一鍵分享至 IG 限動 / 下載卡片</span>
              </button>

              <button
                onClick={handleShareToMicroservice}
                disabled={sharingToMicroservice}
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all text-sm disabled:opacity-50"
              >
                {sharingToMicroservice && pollingStatus ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    <span>
                      {pollingStatus === 'queued' && '排隊中...'}
                      {pollingStatus === 'posting' && '發佈中...'}
                      {pollingStatus === 'completed' && '發佈完成'}
                      {pollingStatus === 'failed' && '發佈失敗'}
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    <span>🚀 遞交至發佈微服務</span>
                  </>
                )}
              </button>

              {/* 任務階段追蹤進度條 */}
              {sharingToMicroservice && pollingStatus && (
                <div className="bg-white/5 rounded-xl p-3 text-xs text-left border border-white/5 flex flex-col gap-2">
                  <div className="flex justify-between items-center text-gray-400">
                    <span>任務階段追蹤：</span>
                    <span className="text-spotify-green animate-pulse font-mono">
                      {pollingStatus === 'queued' && '⏳ 排隊中 (queued)'}
                      {pollingStatus === 'posting' && '📡 發佈中 (posting)'}
                      {pollingStatus === 'completed' && '✅ 已完成 (completed)'}
                      {pollingStatus === 'failed' && '❌ 失敗 (failed)'}
                    </span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        pollingStatus === 'queued' ? 'w-1/3 bg-amber-500' :
                        pollingStatus === 'posting' ? 'w-2/3 bg-indigo-500' :
                        pollingStatus === 'completed' ? 'w-full bg-spotify-green' :
                        'w-full bg-red-500'
                      }`}
                    ></div>
                  </div>
                </div>
              )}

              {socialShareMessage && (
                <div className={`p-3 rounded-xl text-xs border text-left leading-relaxed ${socialShareMessage.success ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400' : 'bg-red-950/40 border-red-500/30 text-red-400'}`}>
                  {socialShareMessage.text}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
      </main>
    </div>
  )
}

export default App
