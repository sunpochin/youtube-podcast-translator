// src/services/transcription.service.js
// YouTube 字幕抓取與音訊轉寫 fallback

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import ytdl from 'ytdl-core';
import { YoutubeTranscript } from 'youtube-transcript';

function buildTranscriptList(items = []) {
  return items.map((item) => ({
    text: item.text,
    start: (item.offset || item.start || 0) / 1000,
    duration: (item.duration || 0) / 1000
  }));
}

async function fetchSubtitleTranscript(videoId) {
  const transcriptList = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
  return buildTranscriptList(transcriptList);
}

async function downloadYouTubeAudio(videoId) {
  const info = await ytdl.getInfo(videoId);
  const format = ytdl.chooseFormat(info.formats, {
    quality: 'highestaudio',
    filter: 'audioonly'
  });

  if (!format) {
    throw new Error('找不到可用的音訊格式');
  }

  const ext = format.container || 'webm';
  const fileName = `yt-audio-${videoId}-${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);
  const writeStream = await fs.open(filePath, 'w');
  const writable = writeStream.createWriteStream();

  await new Promise((resolve, reject) => {
    const stream = ytdl.downloadFromInfo(info, {
      quality: format.itag,
      filter: 'audioonly'
    });
    stream.on('error', reject);
    writable.on('error', reject);
    writable.on('finish', resolve);
    stream.pipe(writable);
  });

  await writeStream.close();
  const audioBuffer = await fs.readFile(filePath);
  await fs.unlink(filePath).catch(() => {});
  return {
    buffer: audioBuffer,
    mimeType: format.mimeType || 'audio/webm',
    fileName
  };
}

function parseTranscriptionText(text = '') {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => ({
    text: line,
    start: index * 5,
    duration: 5
  }));
}

async function transcribeAudioBuffer({ buffer, mimeType, fileName }) {
  const endpoint = process.env.TRANSCRIPTION_ENDPOINT;
  const openAiKey = process.env.OPENAI_API_KEY;
  const openAiModel = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

  if (endpoint) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), fileName);
    form.append('model', openAiModel);
    form.append('language', 'en');

    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      throw new Error(`轉寫服務失敗: ${response.status}`);
    }

    const data = await response.json();
    const text = data.text || data.transcript || '';
    return parseTranscriptionText(text);
  }

  if (openAiKey) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), fileName);
    form.append('model', openAiModel);
    form.append('language', 'en');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`
      },
      body: form,
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      throw new Error(`OpenAI 轉寫失敗: ${response.status}`);
    }

    const data = await response.json();
    return parseTranscriptionText(data.text || '');
  }

  throw new Error('字幕已停用，且未設定可用的音訊轉寫服務。請設定 OPENAI_API_KEY 或 TRANSCRIPTION_ENDPOINT。');
}

export async function getTranscriptWithFallback(videoId) {
  try {
    const transcript = await fetchSubtitleTranscript(videoId);
    return { source: 'subtitle', transcript };
  } catch (err) {
    if (!String(err.message || '').toLowerCase().includes('transcript is disabled')) {
      throw err;
    }

    const audio = await downloadYouTubeAudio(videoId);
    const transcript = await transcribeAudioBuffer(audio);
    return { source: 'transcribe', transcript };
  }
}
