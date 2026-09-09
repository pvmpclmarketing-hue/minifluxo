import { groupTimedWords, lyricsForCaptions } from './captions.js';

// Whisper can occasionally place one or two prompt-biased words at 0 s while
// the audio is still in its instrumental intro.  When that tiny opening is
// followed by a real multi-second silence, attach it to the first voiced
// cluster instead of displaying it over the intro.
function repairOpeningTiming(words) {
  if (words[0]?.start > 0.25) return words;
  const anchorIndex = words.findIndex((word, index) => index > 0
    && word.start - words[index - 1].end >= 3
    && words[index - 1].end <= 3);
  if (anchorIndex < 1) return words;

  const opening = words.slice(0, anchorIndex);
  const duration = opening.reduce((total, word) => total + Math.max(0.04, word.end - word.start), 0);
  let cursor = Math.max(0, words[anchorIndex].start - duration);
  return words.map((word, index) => {
    if (index >= anchorIndex) return word;
    const wordDuration = Math.max(0.04, word.end - word.start);
    const repaired = { ...word, start: cursor, end: cursor + wordDuration };
    cursor = repaired.end;
    return repaired;
  });
}

// Timing and coverage come from the audio. The lyric text supplies spelling
// context, but a language model must not silently remove or rewrite verses.
export function blocksFromTranscript(words) {
  const recognized = (Array.isArray(words) ? words : []).map(item => ({
    text: String(item.word || '').trim(), start: Number(item.start), end: Number(item.end),
  })).filter(item => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.start < 60 && item.end >= item.start).sort((a, b) => a.start - b.start);
  const timed = repairOpeningTiming(recognized);
  const result = timed.map((word, index) => ({
    ...word,
    end: Math.min(60, Math.max(word.end, word.start + 0.04), timed[index + 1]?.start > word.start ? timed[index + 1].start : 60),
  }));
  if (!result.length) throw new Error('A transcrição não retornou palavras nos primeiros 60 segundos.');
  return groupTimedWords(result);
}

export async function createSyncedCaptionBlocks({ audioUrl, lyrics, apiKey }) {
  if (!apiKey) throw new Error('Cadastre sua chave GPT na aba APIs para sincronizar a letra automaticamente.');
  const source = await fetch(audioUrl);
  if (!source.ok) throw new Error('Não foi possível ler o MP3 para sincronizar a letra.');
  const audio = await source.blob();
  const form = new FormData();
  form.append('file', audio, 'musica.mp3');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('language', 'pt');
  // Keep context bounded; timestamps still come exclusively from recognition.
  form.append('prompt', lyricsForCaptions(lyrics).split(/\s+/).slice(0, 180).join(' '));
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Transcrição: ${payload?.error?.message || response.status}`);
  return blocksFromTranscript(payload.words);
}
