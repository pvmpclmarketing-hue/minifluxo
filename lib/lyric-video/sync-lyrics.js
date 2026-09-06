import { lyricsForCaptions, normalizeCaptionBlocks } from './captions.js';

const parseJson = (value) => {
  try { return JSON.parse(value); } catch {
    const match = String(value || '').match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
};

async function transcribeWords(audioUrl, apiKey) {
  const source = await fetch(audioUrl);
  if (!source.ok) throw new Error('Não foi possível ler o MP3 para sincronizar a letra.');
  const audio = await source.blob();
  const form = new FormData();
  form.append('file', audio, 'musica.mp3');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Transcrição: ${payload?.error?.message || response.status}`);
  const words = Array.isArray(payload.words) ? payload.words.map(item => ({ word: String(item.word || ''), start: Number(item.start), end: Number(item.end) })).filter(item => item.word && Number.isFinite(item.start) && Number.isFinite(item.end)) : [];
  if (!words.length) throw new Error('A transcrição não retornou os tempos das palavras.');
  return words;
}

async function alignLyrics(originalLyrics, words, apiKey) {
  const prompt = `Você sincroniza legendas de músicas em português. Compare a LETRA ORIGINAL com a TRANSCRIÇÃO COM TEMPOS. Retorne APENAS JSON válido no formato {"blocks":[{"start":0,"end":0,"text":""}]}.\n\nRegras obrigatórias:\n- Remova marcadores como [Verso 1], [Refrão] e [Ponte].\n- O texto de cada bloco deve usar a letra original corrigida, nunca títulos de seção.\n- Agrupe 3 a 8 palavras por bloco, mantendo uma leitura natural.\n- Use o início da primeira palavra e o fim da última palavra correspondente na transcrição; não invente tempos.\n- Respeite a ordem cantada, não pule trechos e não crie novas palavras.\n- Use apenas blocos que terminem até 60 segundos.\n\nLETRA ORIGINAL:\n${lyricsForCaptions(originalLyrics)}\n\nTRANSCRIÇÃO COM TEMPOS:\n${JSON.stringify(words)}`;
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.4-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Responda somente JSON válido.' }, { role: 'user', content: prompt }] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Alinhamento da letra: ${payload?.error?.message || response.status}`);
  const json = parseJson(payload?.choices?.[0]?.message?.content);
  const blocks = normalizeCaptionBlocks(json?.blocks);
  if (!blocks.length) throw new Error('O alinhamento não produziu legendas utilizáveis.');
  return blocks;
}

export async function createSyncedCaptionBlocks({ audioUrl, lyrics, apiKey }) {
  if (!apiKey) throw new Error('Cadastre sua chave GPT na aba APIs para sincronizar a letra automaticamente.');
  const words = await transcribeWords(audioUrl, apiKey);
  return alignLyrics(lyrics, words, apiKey);
}
