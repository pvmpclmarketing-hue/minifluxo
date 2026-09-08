import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';
import { normalizeCaptionBlocks } from '../../../lib/lyric-video/captions';
import { submitLyricVideo } from '../../../lib/lyric-video/submit';
import { credentialsFor } from '../flow-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  try {
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
    const updated = await submitLyricVideo({ db, ownerId: user.id, audioUrl, lyrics, orderId: body.order_id || null, introText, theme: body.theme, timestamps, gptApiKey: (await credentialsFor(db, null, user.id)).gpt || process.env.OPENAI_API_KEY });
    return NextResponse.json(updated, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não foi possível criar o lyric video.' }, { status: 500 });
  }
}
