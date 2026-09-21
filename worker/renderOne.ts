import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { createTimeline } from '../src/video/timeline';
import { ffprobeDuration } from '../src/services/ffmpeg';
import { downloadAsset } from '../src/services/download';

const apiUrl = process.env.WORKER_API_URL?.replace(/\/$/, '');
const token = process.env.VIDEO_WORKER_TOKEN;
const orderId = process.argv[2];

async function api(body: Record<string, unknown>) {
  if (!apiUrl || !token) throw new Error('WORKER_API_URL ou VIDEO_WORKER_TOKEN não configurado.');
  const response = await fetch(`${apiUrl}/api/video-worker`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha na API do worker.');
  return data;
}

async function run() {
  if (!orderId) throw new Error('Informe o ID do pedido de vídeo.');
  console.log('[render] claiming order', { orderId });
  const claimed = await api({ action: 'claim-order', orderId });
  const order = claimed.order;
  if (!order) { console.log('[render] order unavailable', { orderId }); return; }
  const directory = await mkdtemp(path.join(os.tmpdir(), `remotion-${order.id}-`));
  try {
    console.log('[render] requesting input URLs', { orderId: order.id });
    const sources = await api({ action: 'input-urls', orderId: order.id });
    console.log('[render] downloading audio', { orderId: order.id });
    const localAudio = await downloadAsset(sources.audioUrl, directory, 'audio');
    const duration = await ffprobeDuration(localAudio);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Não foi possível ler a duração completa da música.');
    console.log('[render] audio ready', { orderId: order.id, duration });
    const timeline = createTimeline({
      audioUrl: sources.audioUrl, photos: sources.photoUrls, lyrics: order.lyrics,
      lyricsTimestamps: order.lyrics_timestamps, introText: order.intro_text, duration, backgroundUrl: sources.backgroundUrl,
    });
    await api({ action: 'status', orderId: order.id, status: 'rendering' });
    console.log('[render] bundling composition', { orderId: order.id });
    const serveUrl = await bundle({ entryPoint: path.resolve('src/video/RemotionRoot.tsx') });
    const composition = await selectComposition({ serveUrl, id: 'MusicVideo', inputProps: { timeline } });
    const output = path.join(directory, 'music-video.mp4');
    console.log('[render] rendering MP4', { orderId: order.id, duration });
    await renderMedia({ serveUrl, composition, codec: 'h264', audioCodec: 'aac', outputLocation: output, inputProps: { timeline }, concurrency: 1 });
    await api({ action: 'status', orderId: order.id, status: 'uploading' });
    console.log('[render] uploading MP4', { orderId: order.id });
    const upload = await api({ action: 'upload-url', orderId: order.id });
    const response = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'x-upsert': 'true' }, body: await readFile(output) });
    if (!response.ok) throw new Error(`Falha ao enviar o MP4 ao Supabase (${response.status}).`);
    await api({ action: 'complete', orderId: order.id, outputUrl: upload.publicUrl });
    console.log('[render] complete', { orderId: order.id });
  } catch (error) {
    console.error('[render] failed', { orderId, error: error instanceof Error ? error.message : String(error) });
    await api({ action: 'status', orderId, status: 'failed', error: error instanceof Error ? error.message : 'Falha desconhecida no render.' });
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void run();
