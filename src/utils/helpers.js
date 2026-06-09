// src/utils/helpers.js
// 專案通用輔助工具函式庫

// 提取 YouTube Video ID
export function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// 將秒數格式化為 mm:ss
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 將字串轉為 URL 友善的 Slug 格式，需與 GitBook 發布器一致
export function generateSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-\u4e00-\u9fa5]+/g, '')
    .replace(/\-\-+/g, '-');
}

// 降級退化方案：將字串轉為 URL 友善的純英文/數字 Slug，防止中文被 GitBook 轉成拼音
export function generateCleanSlugFallback(title, videoId) {
  // 1. 先嘗試只提取英文、數字字元來產生 Slug
  const cleanEnglish = title
    .toString()
    .replace(/[\u4e00-\u9fa5]+/g, '') // 移除中文
    .replace(/[^\w\s\-]+/g, '')      // 移除特殊字元
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/\-\-+/g, '-');

  // 去除開頭與結尾的連字號
  const finalEnglish = cleanEnglish.replace(/^-+|-+$/g, '');

  if (finalEnglish && finalEnglish.length > 3) {
    return finalEnglish;
  }

  // 2. 如果純英文長度不足或為空，則降級使用傳統含中文的 slug 產生方式 (GitBook 會將其轉為拼音)
  const fallback = generateSlug(title);
  if (fallback && fallback.replace(/^-+|-+$/g, '')) {
    return fallback.replace(/^-+|-+$/g, '');
  }

  // 3. 最末端防護：直接使用影片 ID
  return videoId;
}
