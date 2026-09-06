import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';
import { buildShotstackEdit } from '../../../lib/lyric-video/build-shotstack-edit';
import { normalizeCaptionBlocks } from '../../../lib/lyric-video/captions';
import { resolveLyricTheme } from '../../../lib/lyric-video/themes';
import { createSyncedCaptionBlocks } from '../../../lib/lyric-video/sync-lyrics';
import { credentialsFor } from '../flow-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The configured key belongs to the production account. An explicit environment
// variable can still override this for a separate sandbox setup.
const shotstackBase = () => `https://api.shotstack.io/edit/${process.env.SHOTSTACK_ENVIRONMENT || 'v1'}`;

async function signedAudioUrl(db, audioUrl) {
  if (!audioUrl.startsWith('storage://video-inputs/')) return audioUrl;
  const path = audioUrl.slice('storage://video-inputs/'.length);
  const { data, error } = await db.storage.from('video-inputs').createSignedUrl(path, 60 * 60 * 12);
  if (error || !data?.signedUrl) throw error || new Error('Não foi possível acessar o MP3 enviado.');
  return data.signedUrl;
}

export async function GET() {
  try {
    const user = await requireUser();
    const { data, error } = await adminClient().from('lyric_video_orders').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não autenticado.' }, { status: 401 });
  }
}

export async function POST(request) {
  let lyricVideo;
  try {
    if (!process.env.SHOTSTACK_API_KEY || !process.env.SHOTSTACK_WEBHOOK_SECRET) throw new Error('A integração Shotstack ainda não foi configurada no servidor.');
    const user = await requireUser();
    const body = await request.json();
    const audioUrl = String(body.audio_url || '').trim();
    const lyrics = String(body.lyrics || '').trim();
    const introText = String(body.intro_text || '').trim() || null;
    const prefix = `storage://video-inputs/${user.id}/audio/`;
    if (!audioUrl || !lyrics) return NextResponse.json({ error: 'Informe o MP3 e a letra da música.' }, { status: 400 });
    if (!audioUrl.startsWith(prefix)) return NextResponse.json({ error: 'O MP3 precisa ser enviado pela sua conta antes de criar o clipe.' }, { status: 400 });
    if (introText && introText.length > 90) return NextResponse.json({ error: 'O texto de introdução deve ter no máximo 90 caracteres.' }, { status: 400 });
    const timestamps = Array.isArray(body.lyrics_timestamps) ? body.lyrics_timestamps : null;
    if (timestamps && normalizeCaptionBlocks(timestamps).length !== timestamps.length) return NextResponse.json({ error: 'Há timestamps inválidos. Cada bloco precisa ter texto e início/fim válidos entre 0 e 60 segundos.' }, { status: 400 });

    const db = adminClient();
    const theme = resolveLyricTheme(body.theme);
    const { data, error } = await db.from('lyric_video_orders').insert({
      owner_id: user.id,
      order_id: body.order_id || null,
      audio_url: audioUrl,
      lyrics,
      lyrics_timestamps: timestamps,
      intro_text: introText,
      theme,
      duration: 60,
      status: 'pending',
    }).select().single();
    if (error) throw error;
    lyricVideo = data;

    const inputUrl = await signedAudioUrl(db, lyricVideo.audio_url);
    const suppliedTimestamps = normalizeCaptionBlocks(lyricVideo.lyrics_timestamps);
    const syncedTimestamps = suppliedTimestamps.length ? suppliedTimestamps : await createSyncedCaptionBlocks({
      audioUrl: inputUrl,
      lyrics: lyricVideo.lyrics,
      apiKey: (await credentialsFor(db, null, user.id)).gpt || process.env.OPENAI_API_KEY,
    });
    const { error: timingError } = await db.from('lyric_video_orders').update({
      lyrics_timestamps: syncedTimestamps,
      timing_source: suppliedTimestamps.length ? 'provided' : 'transcribed',
      status: 'processing',
      updated_at: new Date().toISOString(),
    }).eq('id', lyricVideo.id);
    if (timingError) throw timingError;
    lyricVideo = { ...lyricVideo, lyrics_timestamps: syncedTimestamps };
    const built = buildShotstackEdit({
      audioUrl: inputUrl,
      lyrics: lyricVideo.lyrics,
      lyricsTimestamps: lyricVideo.lyrics_timestamps,
      introText: lyricVideo.intro_text,
      theme: lyricVideo.theme,
    });
    const callback = `${process.env.APP_URL || 'https://minifluxo.vercel.app'}/api/webhooks/shotstack-lyric-video?order=${lyricVideo.id}&token=${encodeURIComponent(process.env.SHOTSTACK_WEBHOOK_SECRET)}`;
    const response = await fetch(`${shotstackBase()}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': process.env.SHOTSTACK_API_KEY },
      body: JSON.stringify({ ...built.edit, callback }),
    });
    const payload = await response.json();
    const renderId = payload?.response?.id || payload?.id;
    if (!response.ok || !payload?.success || !renderId) {
      const providerMessage = payload?.message || payload?.error || payload?.errors?.map((item) => item?.message || item?.detail || JSON.stringify(item)).filter(Boolean).join('; ') || payload?.response?.message || `HTTP ${response.status}`;
      console.error('[lyric-video] Shotstack rejected render', JSON.stringify({ status: response.status, providerMessage, payload }));
      throw new Error(`Shotstack: ${providerMessage}`);
    }
    const { data: updated, error: updateError } = await db.from('lyric_video_orders').update({
      status: 'rendering', shotstack_render_id: String(renderId), theme: built.theme, timing_source: built.timingSource, updated_at: new Date().toISOString(), error: null,
    }).eq('id', lyricVideo.id).select().single();
    if (updateError) throw updateError;
    return NextResponse.json(updated, { status: 201 });
  } catch (error) {
    if (lyricVideo?.id) await adminClient().from('lyric_video_orders').update({ status: 'failed', error: error.message || 'Falha ao enviar para a Shotstack.', updated_at: new Date().toISOString() }).eq('id', lyricVideo.id);
    return NextResponse.json({ error: error.message || 'Não foi possível criar o lyric video.' }, { status: 500 });
  }
}
