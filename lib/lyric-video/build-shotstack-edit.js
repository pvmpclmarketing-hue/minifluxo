import { generateLyricsTiming } from './captions.js';
import { LYRIC_VIDEO_THEMES, lyricThemeAsset, resolveLyricTheme } from './themes.js';

const safeLength = (start, end) => Number(Math.max(0.6, end - start).toFixed(2));

function fontSize(text) {
  if (text.length > 82) return 'medium';
  if (text.length > 48) return 'large';
  return 'x-large';
}

export function buildShotstackEdit({ audioUrl, lyrics, lyricsTimestamps, introText, theme }) {
  const themeKey = resolveLyricTheme(theme);
  const selectedTheme = LYRIC_VIDEO_THEMES[themeKey];
  const timing = generateLyricsTiming(lyrics, lyricsTimestamps);
  const tracks = [
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
    {
      clips: timing.blocks.map(block => ({
        asset: {
          type: 'title', text: block.text, style: 'minimal', size: fontSize(block.text),
          color: '#FFFFFF', background: 'rgba(0,0,0,0.18)',
        },
        start: block.start,
        length: safeLength(block.start, block.end),
        position: 'center',
        transition: { in: 'fade', out: 'fade' },
      })),
    },
    {
      clips: [{
        asset: { type: 'title', text: ' ', style: 'minimal', size: 'small', color: selectedTheme.accent },
        start: 58,
        length: 2,
        position: 'center',
        transition: { in: 'fade', out: 'fade' },
      }],
    },
  ];

  if (introText?.trim()) {
    tracks.push({ clips: [{
      asset: { type: 'title', text: introText.trim(), style: 'minimal', size: 'large', color: '#FFFFFF' },
      start: 2,
      length: 3,
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
