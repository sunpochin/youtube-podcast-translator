// dashboard/src/components/Header.jsx
// 頂部導航列組件，顯示網頁標題與 Gemini 技術標記

import { Play } from 'lucide-react'

export default function Header() {
  return (
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
  )
}
