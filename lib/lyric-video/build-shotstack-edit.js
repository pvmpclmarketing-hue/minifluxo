import { generateLyricsTiming } from './captions.js';
import { LYRIC_VIDEO_THEMES, lyricThemeAsset, resolveLyricTheme } from './themes.js';

const FONT_URL = 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuBWYMZg.ttf';
const WIDTH = 760;
const CENTER_Y = 800;
const round = value => Number(value.toFixed(3));
const HEART_COLORS = {
  romantic_rose: '#FF9EB5',
  night_love: '#F3A5B5',
  soft_gold: '#F4CF9B',
};

// Conservative glyph widths leave room for accents, shadows and wide capitals.
export function textWidth(text, size) {
  return Array.from(text).reduce((sum, char) => sum + (/\s/.test(char) ? 0.3 : /[MW@]/.test(char) ? 1 : /[I1.,!':;]/.test(char) ? 0.34 : 0.73), 0) * size;
}

export function layoutCaption(block) {
  // Grande o bastante para leitura no celular, mas com mais respiro que a
  // versão anterior dentro da moldura do player.
  for (let size = 96; size >= 28; size -= 2) {
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
    // A legenda só pode aparecer quando a primeira palavra é cantada. Um
    // pequeno adiantamento fica especialmente evidente na abertura da música.
    const start = Math.max(block.start, words[0].start);
    return { clips: [{
      asset: {
        type: 'rich-text', text,
        font: { family: 'Inter', size, weight: 900, color: '#FFFFFF' },
        // A borda fina preserva a leitura sobre áreas claras do template sem
        // transformar a letra em uma tarja ou perder o aspecto editorial.
        stroke: { width: 2, color: '#120A0D', opacity: 0.9 },
        shadow: { offsetX: 0, offsetY: 3, blur: 8, color: '#000000', opacity: 0.7 },
        align: { horizontal: 'center', vertical: 'middle' },
        // Movimento curto de entrada: dá vida à frase sem atrasar a leitura.
        animation: { preset: 'ascend', duration: 0.28, direction: 'up' },
      },
      start: round(start),
      // Earlier lines remain visible while the rest of the phrase is sung.
      length: round(block.end - start),
      width: WIDTH, height: lineHeight + 24,
      position: 'center', offset: { x: 0, y: round((960 - y) / 1920) },
    }] };
  });
}

// Dense, staggered bursts make the effect clearly visible on a phone while
// the central safe area stays free for the lyric.
function heartEffectTracks(themeKey) {
  const hearts = [
    { x: -0.4, y: -0.38, delay: 0.6, size: 90 },
    { x: 0.4, y: -0.3, delay: 0.82, size: 72 },
    { x: -0.42, y: -0.1, delay: 1.04, size: 64 },
    { x: 0.41, y: 0.08, delay: 0.72, size: 84 },
    { x: -0.39, y: 0.2, delay: 0.94, size: 76 },
    { x: 0.4, y: 0.32, delay: 1.16, size: 66 },
    { x: -0.37, y: 0.4, delay: 0.76, size: 80 },
    { x: 0.34, y: 0.42, delay: 1.08, size: 58 },
  ];
  return hearts.map(({ x, y, delay, size }) => ({ clips: Array.from({ length: 24 }, (_, beat) => ({
    asset: {
      type: 'rich-text', text: '♥',
      font: { family: 'Inter', size, weight: 900, color: HEART_COLORS[themeKey], opacity: 0.94 },
      stroke: { width: 2, color: '#7A2438', opacity: 0.58 },
      shadow: { offsetX: 0, offsetY: 3, blur: 10, color: '#FEE8EE', opacity: 0.8 },
      align: { horizontal: 'center', vertical: 'middle' },
      animation: { preset: 'fadeIn', duration: 0.1 },
    },
    start: round(delay + beat * 2.5), length: 0.64, width: 180, height: 180,
    position: 'center', offset: { x, y },
  })).filter(clip => clip.start < 60) }));
}

export function buildShotstackEdit({ audioUrl, lyrics, lyricsTimestamps, introText, theme }) {
  const themeKey = resolveLyricTheme(theme);
  const timing = generateLyricsTiming(lyrics, lyricsTimestamps);
  const firstLyricStart = timing.blocks[0]?.start || 0;
  const tracks = [
    ...timing.blocks.flatMap(typographyTracks),
    ...heartEffectTracks(themeKey),
    { clips: [{
      asset: { type: 'image', src: lyricThemeAsset(themeKey) },
      start: 0, length: 60, fit: 'crop', position: 'center', effect: 'zoomInSlow',
    }] },
  ];
  if (firstLyricStart > 1.5) tracks.unshift({ clips: [{
    asset: {
      type: 'rich-text', text: introText?.trim() || 'UMA CANÇÃO\nFEITA PARA VOCÊ',
      font: { family: 'Inter', size: 62, weight: 900, color: '#FFE3E8' },
      stroke: { width: 1, color: '#120A0D', opacity: 0.8 },
      align: { horizontal: 'center', vertical: 'middle' },
      animation: { preset: 'fadeIn', duration: 0.6 },
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
