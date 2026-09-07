const sectionMarker = /\[(?:verso|verse|refr[aã]o|chorus|pr[eé]-?refr[aã]o|pre-?chorus|ponte|bridge|intro(?:du[cç][aã]o)?|outro|final)[^\]]*\]/gi;
const clean = value => String(value || '').replace(sectionMarker, ' ').replace(/\s+/g, ' ').trim();
const round = value => Number(value.toFixed(2));

export function normalizeCaptionBlocks(value) {
  if (!Array.isArray(value)) return [];
  const blocks = value.map(item => ({
    start: Number(item?.start),
    end: Number(item?.end),
    text: clean(item?.text),
  })).filter(item => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.end > item.start && item.end <= 60).sort((a, b) => a.start - b.start);
  // A provider or model can return timestamps that overlap by a few seconds.
  // Each caption gets a single lane, so close it just before the next one starts.
  return blocks.map((item, index) => ({ ...item, end: Math.min(item.end, (blocks[index + 1]?.start ?? item.end) - 0.08) })).filter(item => item.end - item.start >= 0.4);
}

export function groupLyricsIntoCaptionBlocks(lyrics) {
  const words = clean(lyrics).split(' ').filter(Boolean);
  const groups = [];
  for (let index = 0; index < words.length; index += 6) groups.push(words.slice(index, index + 6).join(' '));
  if (!groups.length) return [];
  const start = 5;
  const end = 58;
  const length = (end - start) / groups.length;
  return groups.map((text, index) => ({ start: round(start + index * length), end: round(start + (index + 1) * length), text }));
}

export function lyricsForCaptions(lyrics) {
  return clean(lyrics);
}

// Futuro: esta função receberá a transcrição por palavra e usará GPT-5.4 mini
// para alinhar a letra original, preservando os tempos reais do áudio.
export function generateLyricsTiming(lyrics, timestamps) {
  const provided = normalizeCaptionBlocks(timestamps);
  return { blocks: provided.length ? provided : groupLyricsIntoCaptionBlocks(lyrics), source: provided.length ? 'provided' : 'estimated' };
}
