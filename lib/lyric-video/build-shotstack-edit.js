import { generateLyricsTiming } from './captions.js';
import { LYRIC_VIDEO_THEMES, lyricThemeAsset, resolveLyricTheme } from './themes.js';

const FONT_URL = 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuBWYMZg.ttf';
const WIDTH = 760;
const CENTER_Y = 800;
const round = value => Number(value.toFixed(3));

// Conservative glyph widths leave room for accents, shadows and wide capitals.
export function textWidth(text, size) {
  return Array.from(text).reduce((sum, char) => sum + (/\s/.test(char) ? 0.3 : /[MW@]/.test(char) ? 1 : /[I1.,!':;]/.test(char) ? 0.34 : 0.73), 0) * size;
}

export function layoutCaption(block) {
  for (let size = 112; size >= 28; size -= 2) {
    const lines = [];
    let line = [];
    for (const word of block.units) {
      if (line.length && textWidth([...line, word].map(w => w.text.toLocaleUpperCase('pt-BR')).join(' '), size) > WIDTH - 48) {
        lines.push(line); line = [];
      }
      line.push(word);
    }
    if (line.length) lines.push(line);
    if (lines.length <= 3 && lines.every(items => textWidth(items.map(w => w.text.toLocaleUpperCase('pt-BR')).join(' '), size) <= WIDTH - 48)) return { lines, size };
  }
  throw new Error('A legenda contém uma palavra longa demais para a área do vídeo.');
}

function typographyTracks(block) {
  const { lines, size } = layoutCaption(block);
  const lineHeight = Math.ceil(size * 1.3);
  const totalHeight = lines.length * lineHeight;
  return lines.map((words, lineIndex) => {
    const text = words.map(word => word.text.toLocaleUpperCase('pt-BR')).join(' ');
    const y = CENTER_Y - totalHeight / 2 + (lineIndex + 0.5) * lineHeight;
    const start = Math.max(block.start, words[0].start - 0.03);
    return { clips: [{
      asset: {
        type: 'rich-text', text,
        font: { family: 'Inter', size, weight: 900, color: '#FFFFFF' },
        background: { color: '#000000', opacity: 0 },
        shadow: { offsetX: 0, offsetY: 3, blur: 8, color: '#000000', opacity: 0.7 },
        align: { horizontal: 'center', vertical: 'middle' },
      },
      start: round(start),
      // Earlier lines remain visible while the rest of the phrase is sung.
      length: round(block.end - start),
      width: WIDTH, height: lineHeight + 24,
      position: 'center', offset: { x: 0, y: round((960 - y) / 1920) },
    }] };
  });
}

export function buildShotstackEdit({ audioUrl, lyrics, lyricsTimestamps, introText, theme }) {
  const themeKey = resolveLyricTheme(theme);
  const timing = generateLyricsTiming(lyrics, lyricsTimestamps);
  const firstLyricStart = timing.blocks[0]?.start || 0;
  const tracks = [
    ...timing.blocks.flatMap(typographyTracks),
    { clips: [{ asset: { type: 'image', src: lyricThemeAsset(themeKey) }, start: 0, length: 60, fit: 'crop', position: 'center' }] },
  ];
  if (firstLyricStart > 1.5) tracks.unshift({ clips: [{
    asset: {
      type: 'rich-text', text: introText?.trim() || 'UMA CANÇÃO\nFEITA PARA VOCÊ',
      font: { family: 'Inter', size: 62, weight: 900, color: '#FFE3E8' },
      background: { color: '#000000', opacity: 0 },
      align: { horizontal: 'center', vertical: 'middle' },
    },
    start: 0.4, length: round(firstLyricStart - 0.6), width: WIDTH, height: 350,
    position: 'center', offset: { x: 0, y: round((960 - CENTER_Y) / 1920) },
  }] });
  const edit = {
    timeline: {
      background: LYRIC_VIDEO_THEMES[themeKey].overlayColor,
      fonts: [{ src: FONT_URL }],
      soundtrack: { src: audioUrl, effect: 'fadeInFadeOut', volume: 1 }, tracks,
    },
    output: { format: 'mp4', size: { width: 1080, height: 1920 }, fps: 30 },
  };
  if (Buffer.byteLength(JSON.stringify(edit), 'utf8') > 350000) throw new Error('A montagem excedeu o limite seguro de tamanho.');
  return { edit, theme: themeKey, duration: 60, timingSource: timing.source };
}
