import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';
import { dispatchRemotionRender } from '../../../lib/remotion/dispatch';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const { data, error } = await adminClient().from('video_orders').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return NextResponse.json({ error: error.message || 'Não autenticado.' }, { status: 401 }); }
}

export async function POST(request) {
  let order;
  try {
    const user = await requireUser();
    const body = await request.json();
    const photos = Array.isArray(body.photos) ? body.photos.map((value) => String(value).trim()).filter(Boolean) : [];
    const prefix = `storage://video-inputs/${user.id}/`;
    if (!body.audio_url || photos.length < 4 || photos.length > 8 || !body.lyrics?.trim()) return NextResponse.json({ error: 'Informe um MP3, a letra e de 4 a 8 fotos.' }, { status: 400 });
    if (!String(body.audio_url).startsWith(prefix) || photos.some((url) => !url.startsWith(prefix))) return NextResponse.json({ error: 'Os arquivos precisam ser enviados pela sua conta antes de criar o vídeo.' }, { status: 400 });
    const db = adminClient();
    const { data, error } = await db.from('video_orders').insert({
      owner_id: user.id, order_id: body.order_id || null, audio_url: String(body.audio_url).trim(), photos,
      lyrics: String(body.lyrics).trim(), lyrics_timestamps: Array.isArray(body.lyrics_timestamps) ? body.lyrics_timestamps : null,
      intro_text: String(body.intro_text || '').trim() || null, status: 'pending',
    }).select().single();
    if (error) throw error;
    order = data;
    await dispatchRemotionRender(order.id);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (order?.id) await adminClient().from('video_orders').update({ status: 'failed', error: error.message || 'Falha ao acionar o GitHub Actions.', updated_at: new Date().toISOString() }).eq('id', order.id);
    return NextResponse.json({ error: error.message || 'Não foi possível criar o vídeo.' }, { status: 500 });
  }
}
