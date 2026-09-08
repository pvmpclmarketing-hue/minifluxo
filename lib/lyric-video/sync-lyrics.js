import { groupTimedWords, lyricsForCaptions } from './captions.js';

// Timing and coverage come from the audio. The lyric text supplies spelling
// context, but a language model must not silently remove or rewrite verses.
export function blocksFromTranscript(words) {
  const timed = (Array.isArray(words) ? words : []).map(item => ({
    text: String(item.word || '').trim(), start: Number(item.start), end: Number(item.end),
  })).filter(item => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.start < 60 && item.end >= item.start).sort((a, b) => a.start - b.start);
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
