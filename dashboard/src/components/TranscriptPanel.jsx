// dashboard/src/components/TranscriptPanel.jsx
// 逐字稿與大綱摘要對照顯示面板組件

import { Languages, Sparkles, Clock } from 'lucide-react'

// 輔助函數：將秒數格式化為 mm:ss
function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function TranscriptPanel({
  activeTab,
  setActiveTab,
  translatedParagraphs,
  transcript,
  summary
}) {
  return (
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
              {summary.split('\n').map((line, idx) => {
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
  )
}
