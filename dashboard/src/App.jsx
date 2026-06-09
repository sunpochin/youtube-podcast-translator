import { useState, useEffect } from 'react'
import { Play, Search, CheckCircle, AlertTriangle, FileText, Download, Sparkles, Languages, Clock } from 'lucide-react'

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
  const [transcript, setTranscript] = useState([])
  const [summary, setSummary] = useState('')
  const [translatedParagraphs, setTranslatedParagraphs] = useState([])
  const [translationProgress, setTranslationProgress] = useState(0) // 翻譯進度百分比
  
  const [isTranslating, setIsTranslating] = useState(false)
  const [activeTab, setActiveTab] = useState('full') // 'full' | 'summary'

  // 密碼與引擎選擇狀態
  const [password, setPassword] = useState('')
  const [translationMode, setTranslationMode] = useState('ollama') // 'ollama' | 'gemini'
  const [isLocal, setIsLocal] = useState(false) // 默認非本地請求

  // GitBook 發佈狀態與自訂標題
  const [publishTitle, setPublishTitle] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishMessage, setPublishMessage] = useState(null)

  // 初始化時檢測是否為本地連線
  useEffect(() => {
    fetch('/api/connection-check')
      .then(res => res.json())
      .then(data => setIsLocal(data.isLocal))
      .catch(err => console.error("檢測連線類型失敗", err))
  }, [])

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
    
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          transcript, 
          videoId,
          password,
          mode: translationMode
        })
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || '翻譯請求失敗')
      }

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
              if (packet.type === 'chunk') {
                receivedParagraphs = [...receivedParagraphs, packet.chunk]
                setTranslatedParagraphs(receivedParagraphs)
                setTranslationProgress(packet.progress)
              } else if (packet.type === 'summary') {
                setSummary(packet.summary)
              } else if (packet.type === 'error') {
                throw new Error(packet.error || '翻譯中途發生錯誤')
              } else if (packet.type === 'done') {
                setPublishTitle(`Podcast 翻譯 - 影片 ${videoId}`)
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
        setPublishMessage({ success: true, text: data.message })
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
    content += `> 影片網址: https://youtube.com/watch?v=${videoId}\\n\\n`
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
              <p className="text-xs text-spotify-text m-0">輸入 YouTube 連結，AI 導讀秒級搞定</p>
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

          {/* 密碼與引擎模式選擇 (僅在本地連線時顯示，外部瀏覽時直接隱藏) */}
          {isLocal && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-white/5">
              {/* 密碼輸入 */}
              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-xs font-semibold text-spotify-text">發佈/Gemini 驗證密碼 (使用 Ollama 翻譯免填)</label>
                <input
                  type="password"
                  placeholder="雲端 Gemini 模式或發佈至 GitBook 時才需填寫..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="px-3 py-2.5 bg-black/40 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-spotify-green transition-all"
                />
              </div>
              
              {/* 引擎切換 */}
              <div className="flex flex-col gap-1.5 text-left">
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
                    <h3 className="font-semibold text-base text-white/90">字幕抓取成功！</h3>
                    <p className="text-sm text-spotify-text mt-1">
                      共抓取到 {transcript.length} 段字幕片段。現在可以使用 Gemini 將其翻譯為繁體中文對照，並分析核心大綱。
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-white/5">
                    {translatedParagraphs.length === 0 || isTranslating ? (
                      <div className="flex flex-col gap-3">
                        {isTranslating && (
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
                              <span>AI 雙語對照翻譯中... ({translationProgress}%)</span>
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
                              <div className={`mt-2 p-3 rounded-lg text-xs border ${publishMessage.success ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400' : 'bg-red-950/40 border-red-500/30 text-red-400'}`}>
                                {publishMessage.text}
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
      </main>
    </div>
  )
}

export default App