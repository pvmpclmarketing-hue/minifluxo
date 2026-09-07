import { generateLyricsTiming } from './captions.js';
import { LYRIC_VIDEO_THEMES, lyricThemeAsset, resolveLyricTheme } from './themes.js';

const escapeHtml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const CAPTION_VISUAL_LEAD = 0.03;
const MAX_LYRIC_WIDTH = 470;
const GROUP_FADE_DURATION = 0.18;

function visualFontSize(text) {
  const length = Array.from(String(text || '')).length;
  let size = length <= 4 ? 144 : length <= 8 ? 118 : length <= 14 ? 90 : 74;
  while (size > 52 && length * size * 0.64 > MAX_LYRIC_WIDTH) size -= 2;
  return size;
}

function roundTime(value) {
  return Number(value.toFixed(3));
}

function fallbackUnits(block) {
  const words = String(block.text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const unitCount = Math.min(4, words.length);
  const sizes = Array(unitCount).fill(1);
  for (let extra = 0; extra < words.length - unitCount; extra += 1) sizes[unitCount - 1 - (extra % unitCount)] += 1;
  const duration = Number(block.end) - Number(block.start);
  let wordIndex = 0;
  let cursor = Number(block.start);
  return sizes.map(size => {
    const unitWords = words.slice(wordIndex, wordIndex + size);
    wordIndex += size;
    const start = cursor;
    cursor += duration * (size / words.length);
    return { text: unitWords.join(' '), start, end: cursor };
  });
}

function unitsForBlock(block) {
  return Array.isArray(block.units) && block.units.length ? block.units : fallbackUnits(block);
}

function lyricMarkup(units, enteringIndex = -1, groupOpacity = 1) {
  const lines = units.map((unit, index) => `<div class="unit${index === enteringIndex ? ' entering' : ''}" style="font-size:${visualFontSize(unit.text)}px">${escapeHtml(unit.text).toLocaleUpperCase('pt-BR')}</div>`).join('');
  return `<div class="lyric" style="opacity:${groupOpacity}">${lines}</div>`;
}

const lyricCss = `.lyric{box-sizing:border-box;width:100%;height:100%;padding:350px 0 0 76px;text-align:left;font-family:Inter,"Helvetica Neue",Helvetica,Arial,sans-serif;font-weight:900;text-transform:uppercase;letter-spacing:-.025em;line-height:.88;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.45);background:radial-gradient(ellipse 470px 600px at 250px 520px,rgba(0,0,0,.22),rgba(0,0,0,0) 72%)}.unit{display:block;white-space:nowrap;margin:0;padding:0}.unit.entering{color:#2a2a2a;opacity:.28;transform:translateY(5px) scale(.985);transition:color .18s cubic-bezier(.22,1,.36,1),opacity .18s cubic-bezier(.22,1,.36,1),transform .18s cubic-bezier(.22,1,.36,1)}`;

function typographyClips(block) {
  const units = unitsForBlock(block);
  if (!units.length) return [];
  const visualStarts = units.map(unit => Math.max(Number(block.start), Number(unit.start) - CAPTION_VISUAL_LEAD));
  const blockEnd = Number(block.end);
  const fadeDuration = Math.min(GROUP_FADE_DURATION, Math.max(0.08, (blockEnd - Number(block.start)) * 0.16));
  const fadeStart = Math.max(visualStarts.at(-1) + 0.08, blockEnd - fadeDuration);
  const dimensions = { width: 1080, height: 1920, position: 'center' };
  const clips = [];

  units.forEach((_, index) => {
    const start = visualStarts[index];
    const end = index === units.length - 1 ? fadeStart : visualStarts[index + 1];
    const activationDuration = Math.min(0.18, Math.max(0.06, (end - start) * 0.35));
    const visible = units.slice(0, index + 1);
    clips.push({
      asset: { type: 'html', html: lyricMarkup(visible, visible.length - 1), css: lyricCss, width: 1080, height: 1920 },
      start: roundTime(start),
      length: roundTime(activationDuration),
      ...dimensions,
    });
    const settledDuration = end - start - activationDuration;
    if (settledDuration > 0.01) clips.push({
      asset: { type: 'html', html: lyricMarkup(visible), css: lyricCss, width: 1080, height: 1920 },
      start: roundTime(start + activationDuration),
      length: roundTime(settledDuration),
      ...dimensions,
    });
  });
  [0.72, 0.36, 0.02].forEach((opacity, index) => clips.push({
    asset: { type: 'html', html: lyricMarkup(units, -1, opacity), css: lyricCss, width: 1080, height: 1920 },
    start: roundTime(fadeStart + fadeDuration * (index / 3)),
    length: roundTime(fadeDuration / 3),
    ...dimensions,
  }));
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
      clips: timing.blocks.flatMap(typographyClips),
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
    output: { format: 'mp4', size: { width: 1080, height: 1920 }, fps: 30 },
    },
    theme: themeKey,
    duration: 60,
    timingSource: timing.source,
  };
}
