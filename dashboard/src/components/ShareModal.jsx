// dashboard/src/components/ShareModal.jsx
// IG Story 限動圖卡與微服務分享彈窗組件

import { Sparkles } from 'lucide-react'

export default function ShareModal({
  show,
  onClose,
  publishMessage,
  publishTitle,
  videoTitle,
  qrPreviewDataUrl,
  shareMode,
  setShareMode,
  customShortUrl,
  setCustomShortUrl,
  keyword,
  setKeyword,
  mockMode,
  setMockMode,
  sharingToMicroservice,
  pollingStatus,
  socialShareMessage,
  handleCopyLink,
  copiedLink,
  handleNativeShare,
  handleShareToMicroservice
}) {
  if (!show || !publishMessage?.success) return null

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-spotify-card border border-white/10 rounded-3xl max-w-md w-full p-6 shadow-2xl relative flex flex-col gap-5 my-8 animate-fade-in text-center">
        
        {/* 關閉按鈕 */}
        <button
          onClick={onClose}
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
  )
}
