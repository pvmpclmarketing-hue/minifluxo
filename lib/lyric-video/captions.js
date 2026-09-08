const clean = value => String(value || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
const key = value => clean(value).toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');

function distribute(text, start, end) {
  const words = clean(text).split(' ').filter(Boolean);
  return words.map((text, index) => ({ text, start: start + (end - start) * index / words.length, end: start + (end - start) * (index + 1) / words.length }));
}

export function normalizeCaptionBlocks(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const start = Number(item?.start);
    const end = Math.min(60, Number(item?.end));
    const text = clean(item?.text);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
    const units = (Array.isArray(item.units) ? item.units : []).map(unit => ({ text: clean(unit.text), start: Number(unit.start), end: Math.min(end, Number(unit.end)) }));
    // Incomplete model units must never replace the complete phrase.
    const complete = units.length && key(units.map(unit => unit.text).join(' ')) === key(text) && units.every(unit => unit.text && Number.isFinite(unit.start) && Number.isFinite(unit.end) && unit.start >= start && unit.end > unit.start);
    return { start, end, text, units: complete ? units.flatMap(unit => distribute(unit.text, unit.start, unit.end)) : distribute(text, start, end) };
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}

export function groupTimedWords(words) {
  const groups = [];
  let group = [];
  const flush = () => { if (group.length) groups.push({ start: group[0].start, end: group.at(-1).end, text: group.map(w => w.text).join(' '), units: group }); group = []; };
  for (const word of words) {
    if (group.length && (group.length >= 6 || word.start - group[0].start > 3.2 || word.start - group.at(-1).end > 0.9)) flush();
    group.push(word);
    if (/[.!?;]$/.test(word.text) && group.length >= 3) flush();
  }
  flush();
  return groups.map((block, index) => ({ ...block, end: Math.min(60, Math.max(block.end, block.start + 0.3), groups[index + 1]?.start ?? 60) })).filter(block => block.end > block.start);
}

export function groupLyricsIntoCaptionBlocks(lyrics) { return groupTimedWords(distribute(lyrics, 5, 58)); }
export function lyricsForCaptions(lyrics) { return clean(lyrics); }
export function generateLyricsTiming(lyrics, timestamps) {
  const provided = normalizeCaptionBlocks(timestamps);
  return { blocks: provided.length ? groupTimedWords(provided.flatMap(block => block.units)) : groupLyricsIntoCaptionBlocks(lyrics), source: provided.length ? 'provided' : 'estimated' };
}
