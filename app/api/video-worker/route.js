import { NextResponse } from 'next/server';
import { adminClient } from '../supabase';

export const dynamic = 'force-dynamic';

function authorized(request) {
  const token = process.env.VIDEO_WORKER_TOKEN;
  return Boolean(token) && request.headers.get('authorization') === `Bearer ${token}`;
}

function reply(data, status = 200) { return NextResponse.json(data, { status }); }

export async function POST(request) {
  if (!authorized(request)) return reply({ error: 'Não autorizado.' }, 401);
  try {
    const body = await request.json();
    const db = adminClient();

    if (body.action === 'claim') {
      const { data, error } = await db.rpc('claim_pending_video_order');
      if (error) throw error;
      return reply({ order: data?.[0] || null });
    }

    const orderId = String(body.orderId || '');
    if (!orderId) return reply({ error: 'orderId é obrigatório.' }, 400);

    if (body.action === 'status') {
      const update = { status: body.status, updated_at: new Date().toISOString() };
      if (body.error !== undefined) update.error = body.error || null;
      const { error } = await db.from('video_orders').update(update).eq('id', orderId);
      if (error) throw error;
      return reply({ ok: true });
    }

    if (body.action === 'input-urls') {
      const { data: order, error } = await db.from('video_orders').select('audio_url,photos').eq('id', orderId).single();
      if (error || !order) throw error || new Error('Pedido não encontrado.');
      const sign = async (value) => {
        if (!value.startsWith('storage://video-inputs/')) return value;
        const path = value.slice('storage://video-inputs/'.length);
        const { data, error: signError } = await db.storage.from('video-inputs').createSignedUrl(path, 3600);
        if (signError || !data?.signedUrl) throw signError || new Error('Não foi possível assinar o arquivo.');
        return data.signedUrl;
      };
      return reply({ audioUrl: await sign(order.audio_url), photoUrls: await Promise.all(order.photos.map(sign)) });
    }

    if (body.action === 'upload-url') {
      const path = `videos/${orderId}/music-video.mp4`;
      const { data, error } = await db.storage.from('video-outputs').createSignedUploadUrl(path, { upsert: true });
      if (error || !data?.signedUrl) throw error || new Error('Não foi possível criar o envio do vídeo.');
      const { data: publicData } = db.storage.from('video-outputs').getPublicUrl(path);
      return reply({ uploadUrl: data.signedUrl, publicUrl: publicData.publicUrl });
    }

    if (body.action === 'complete') {
      const { error } = await db.from('video_orders').update({ status: 'complete', output_url: body.outputUrl, error: null, updated_at: new Date().toISOString() }).eq('id', orderId);
      if (error) throw error;
      return reply({ ok: true });
    }

    return reply({ error: 'Ação inválida.' }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Erro interno.' }, 500);
  }
}
