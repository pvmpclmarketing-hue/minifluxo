import { generateLyricsTiming } from './captions.js';
import { LYRIC_VIDEO_THEMES, lyricThemeAsset, resolveLyricTheme } from './themes.js';

function fontSize(text) {
  if (text.length > 82) return 58;
  if (text.length > 48) return 70;
  return 84;
}

const escapeHtml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function lyricMarkup(words, entering = false) {
  return `<div class="lyric">${words.map((word, index) => `<span class="${entering && index === words.length - 1 ? 'entering' : ''}">${escapeHtml(word)}</span>`).join(' ')}</div>`;
}

function roundTime(value) {
  return Number(value.toFixed(3));
}

function lyricCss(text) {
  return `.lyric{box-sizing:border-box;width:100%;height:100%;display:flex;align-content:center;justify-content:flex-start;flex-wrap:wrap;padding:0 42px;text-align:left;font-family:"Arial Black",Arial,sans-serif;font-size:${fontSize(text)}px;font-weight:900;text-transform:uppercase;line-height:.98;letter-spacing:-2px;color:#fff;word-spacing:3px;text-shadow:0 3px 16px rgba(0,0,0,.76);overflow-wrap:normal}.lyric span{display:inline-block;white-space:nowrap}.lyric .entering{color:#6f6870}`;
}

function reelCaptionClips(block) {
  const words = String(block.text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const duration = Math.max(0.12, Number(block.end) - Number(block.start));
  const wordDuration = duration / words.length;
  const css = lyricCss(block.text);
  const dimensions = { width: 900, height: 520, position: 'center' };
  const clips = [];

  // O vídeo de referência monta a frase progressivamente. A palavra que está
  // chegando aparece em cinza e, alguns quadros depois, vira branca. Cada
  // estado é sequencial: nunca há duas letras concorrendo na mesma tela.
  words.forEach((_, index) => {
    const start = Number(block.start) + index * wordDuration;
    const end = index === words.length - 1 ? Number(block.end) : Number(block.start) + (index + 1) * wordDuration;
    const mutedDuration = Math.min(0.12, Math.max(0.04, (end - start) * 0.34));
    const visible = words.slice(0, index + 1);
    clips.push({
      asset: { type: 'html', html: lyricMarkup(visible, true), css, width: 900, height: 520 },
      start: roundTime(start),
      length: roundTime(mutedDuration),
      ...dimensions,
    });
    const settledDuration = end - start - mutedDuration;
    if (settledDuration > 0.01) clips.push({
      asset: { type: 'html', html: lyricMarkup(visible), css, width: 900, height: 520 },
      start: roundTime(start + mutedDuration),
      length: roundTime(settledDuration),
      ...dimensions,
    });
  });
  return clips;
}

function visualizerSvg(frame) {
  const bars = Array.from({ length: 31 }, (_, index) => {
    const wave = Math.sin((index + frame * 1.65) * 0.78) + Math.sin((index * 1.37 - frame) * 0.53);
    const height = Math.round(12 + Math.max(0, wave + 1.15) * 36);
    const x = 24 + index * 28;
    const y = 80 - height / 2;
    return `<rect x="${x}" y="${y}" width="5" height="${height}" rx="2.5" fill="#FFD4D8"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="160" viewBox="0 0 900 160">${bars}</svg>`;
}

export function buildShotstackEdit({ audioUrl, lyrics, lyricsTimestamps, introText, theme }) {
  const themeKey = resolveLyricTheme(theme);
  const selectedTheme = LYRIC_VIDEO_THEMES[themeKey];
  const timing = generateLyricsTiming(lyrics, lyricsTimestamps);
  // A animação pertence somente à introdução. Ela termina antes da primeira
  // frase, deixando as letras livres no centro como nos vídeos do Reels.
  const firstLyricStart = Number(timing.blocks[0]?.start || 0);
  const introDuration = Math.max(0, Math.min(7, firstLyricStart - 0.18));
  // Shotstack renders tracks from the first (top) to the last (bottom).
  // Keep the captions above the visual layer so they never disappear behind it.
  const tracks = [
    {
      clips: timing.blocks.flatMap(reelCaptionClips),
    },
    {
      clips: [{
        asset: { type: 'image', src: lyricThemeAsset(themeKey) },
        start: 0,
        length: 60,
        fit: 'crop',
        position: 'center',
      }],
    },
  ];

  if (introText?.trim() && introDuration >= 1.2) {
    tracks.unshift({ clips: [{
      asset: {
        type: 'rich-text', text: introText.trim(),
        font: { family: 'Arapey', size: 74, weight: 600, color: '#FFFFFF' },
        shadow: { offsetX: 0, offsetY: 4, blur: 14, color: '#000000', opacity: 0.7 },
        align: { horizontal: 'center', vertical: 'middle' },
      },
      start: 0.45,
      length: Math.max(0.6, introDuration - 0.45),
      width: 900,
      height: 240,
      position: 'center',
    }] });
  }

  // The opening visualizer is part of the template, with or without an intro phrase.
  // Each frame is sequential (not overlapping) so Shotstack visibly pulses the bars.
  if (introDuration >= 0.4) tracks.splice(tracks.length - 1, 0, {
    clips: Array.from({ length: Math.ceil(introDuration / 0.42) }, (_, frame) => ({
      asset: { type: 'svg', src: visualizerSvg(frame) },
      start: Number((frame * 0.42).toFixed(2)),
      length: Number(Math.min(0.42, introDuration - frame * 0.42).toFixed(2)),
      width: 760,
      height: 150,
      position: 'center',
    })),
  });

  return {
    edit: {
      timeline: {
        background: selectedTheme.overlayColor,
        soundtrack: { src: audioUrl, effect: 'fadeInFadeOut', volume: 1 },
        tracks,
      },
    output: { format: 'mp4', size: { width: 1080, height: 1920 }, fps: 25 },
    },
    theme: themeKey,
    duration: 60,
    timingSource: timing.source,
  };
}
