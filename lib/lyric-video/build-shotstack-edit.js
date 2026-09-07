import { generateLyricsTiming } from './captions.js';
import { LYRIC_VIDEO_THEMES, lyricThemeAsset, resolveLyricTheme } from './themes.js';

const safeLength = (start, end) => Number(Math.max(0.6, end - start).toFixed(2));

function fontSize(text) {
  if (text.length > 82) return 46;
  if (text.length > 48) return 56;
  return 68;
}

const escapeHtml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function lyricMarkup(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) return `<div class="lyric lyric-single">${escapeHtml(text)}</div>`;
  const firstEnd = Math.max(1, Math.round(words.length * 0.28));
  const lastStart = Math.max(firstEnd + 1, Math.round(words.length * 0.72));
  const first = words.slice(0, firstEnd).join(' ');
  const focus = words.slice(firstEnd, lastStart).join(' ');
  const last = words.slice(lastStart).join(' ');
  return `<div class="lyric"><span>${escapeHtml(first)}</span><strong>${escapeHtml(focus)}</strong><span>${escapeHtml(last)}</span></div>`;
}

export function buildShotstackEdit({ audioUrl, lyrics, lyricsTimestamps, introText, theme }) {
  const themeKey = resolveLyricTheme(theme);
  const selectedTheme = LYRIC_VIDEO_THEMES[themeKey];
  const timing = generateLyricsTiming(lyrics, lyricsTimestamps);
  // Shotstack renders tracks from the first (top) to the last (bottom).
  // Keep the captions above the visual layer so they never disappear behind it.
  const tracks = [
    {
      clips: timing.blocks.map(block => ({
        asset: {
          type: 'html',
          html: lyricMarkup(block.text),
          css: `.lyric{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:Arial,sans-serif;text-transform:none;line-height:1.16;letter-spacing:-1px;color:#d9a8ae;text-shadow:0 3px 15px rgba(0,0,0,.72)}.lyric span{font-size:${Math.round(fontSize(block.text) * .78)}px;font-weight:400}.lyric strong{font-size:${fontSize(block.text)}px;font-weight:800;color:#fff5f5;margin:11px 0;text-shadow:0 2px 22px rgba(255,174,187,.38)}.lyric-single{font-size:${fontSize(block.text)}px;font-weight:700;color:#fff5f5}.lyric>*{display:block}`,
          width: 940,
          height: 360,
        },
        start: block.start,
        length: safeLength(block.start, block.end),
        width: 940,
        height: 360,
        position: 'center',
        transition: { in: 'fade', out: 'fade' },
      })),
    },
    {
      clips: [{
        asset: { type: 'image', src: lyricThemeAsset(themeKey) },
        start: 0,
        length: 60,
        fit: 'crop',
        effect: 'zoomIn',
        position: 'center',
        transition: { in: 'fade', out: 'fade' },
      }],
    },
  ];

  if (introText?.trim()) {
    tracks.unshift({ clips: [{
      asset: {
        type: 'rich-text', text: introText.trim(),
        font: { family: 'Arapey', size: 74, weight: 600, color: '#FFFFFF' },
        shadow: { offsetX: 0, offsetY: 4, blur: 14, color: '#000000', opacity: 0.7 },
        align: { horizontal: 'center', vertical: 'middle' },
      },
      start: 2,
      length: 3,
      width: 900,
      height: 240,
      position: 'center',
      transition: { in: 'fade', out: 'fade' },
    }] });
  }

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
