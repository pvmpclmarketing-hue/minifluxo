import { generateLyricsTiming } from './captions.js';
import { LYRIC_VIDEO_THEMES, lyricThemeAsset, resolveLyricTheme } from './themes.js';

const safeLength = (start, end) => Number(Math.max(0.6, end - start).toFixed(2));

function fontSize(text) {
  if (text.length > 82) return 50;
  if (text.length > 48) return 58;
  return 66;
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
          type: 'rich-text',
          text: block.text,
          font: { family: 'Montserrat', size: fontSize(block.text), weight: 800, color: '#FFFFFF' },
          style: { lineHeight: 1.18, textTransform: 'uppercase' },
          stroke: { width: 3, color: '#1A1016', opacity: 0.9 },
          shadow: { offsetX: 0, offsetY: 5, blur: 14, color: '#000000', opacity: 0.72 },
          background: { color: '#140C12', opacity: 0.58, borderRadius: 28 },
          padding: 28,
          align: { horizontal: 'center', vertical: 'middle' },
        },
        start: block.start,
        length: safeLength(block.start, block.end),
        width: 940,
        height: 330,
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
