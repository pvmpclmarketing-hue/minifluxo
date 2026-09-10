import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { sendMedia } from '../../provider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const shotstackBase = () => `https://api.shotstack.io/edit/${process.env.SHOTSTACK_ENVIRONMENT || 'v1'}`;

function markVideoAsSent(context, lyricVideoId, outputUrl) {
  const videos = context?.flow_data?.lyric_videos || {};
  let found = false;
  const sentAt = new Date().toISOString();
  const updatedVideos = Object.fromEntries(Object.entries(videos).map(([nodeId, video]) => {
    if (String(video?.order_id || '') !== String(lyricVideoId)) return [nodeId, video];
    found = true;
    return [nodeId, { ...video, status: 'complete', output_url: outputUrl, sent_at: sentAt }];
  }));
  if (!found) return context;
  return { ...context, flow_data: { ...(context.flow_data || {}), lyric_videos: updatedVideos } };
}

async function completeAndDeliverVideo(db, order, outputUrl) {
  const now = new Date().toISOString();

  // Vídeos criados manualmente no painel não pertencem a um lead do fluxo.
  if (!order.order_id) {
    const { error } = await db.from('lyric_video_orders').update({ status: 'complete', output_url: outputUrl, error: null, updated_at: now }).eq('id', order.id).eq('shotstack_render_id', String(order.shotstack_render_id));
    if (error) throw error;
    return { delivery: 'not_applicable' };
  }

  // A callback da Shotstack pode ser repetida. A transição para "delivering"
  // é a trava que permite apenas uma tentativa de envio por render concluído.
  const { data: claim, error: claimError } = await db.from('lyric_video_orders')
    .update({ status: 'delivering', output_url: outputUrl, error: null, updated_at: now })
    .eq('id', order.id)
    .eq('shotstack_render_id', String(order.shotstack_render_id))
    .eq('status', 'rendering')
    .select('id')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claim) return { delivery: 'already_processed' };

  try {
    const { data: lead, error: leadError } = await db.from('leads')
      .select('*')
      .eq('owner_id', order.owner_id)
      .eq('external_order_id', order.order_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (leadError) throw leadError;
    if (!lead) throw new Error('Lead do pedido não encontrado para entregar o lyric video.');

    const { data: connection, error: connectionError } = await db.from('connections')
      .select('*')
      .eq('id', lead.connection_id)
      .eq('owner_id', order.owner_id)
      .eq('status', 'connected')
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) throw new Error('A conexão de WhatsApp deste lead não está ativa.');

    await sendMedia(connection, lead.phone, 'video', outputUrl, '💖 Seu lyric video está pronto!');

    const { error: leadUpdateError } = await db.from('leads').update({
      order_context: markVideoAsSent(lead.order_context || {}, order.id, outputUrl),
      updated_at: new Date().toISOString(),
    }).eq('id', lead.id).eq('owner_id', lead.owner_id).eq('connection_id', lead.connection_id);
    if (leadUpdateError) throw leadUpdateError;

    const { error: completeError } = await db.from('lyric_video_orders')
      .update({ status: 'complete', output_url: outputUrl, error: null, updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('status', 'delivering');
    if (completeError) throw completeError;

    console.info('[lyric-video delivery] WhatsApp video sent', { lyric_video_order_id: order.id, lead_id: lead.id });
    return { delivery: 'sent' };
  } catch (error) {
    await db.from('lyric_video_orders').update({
      status: 'rendering',
      output_url: outputUrl,
      error: `Entrega no WhatsApp: ${error.message || 'falhou'}`,
      updated_at: new Date().toISOString(),
    }).eq('id', order.id).eq('status', 'delivering');
    console.error('[lyric-video delivery] WhatsApp delivery failed', { lyric_video_order_id: order.id, error: error.message || String(error) });
    throw error;
  }
}

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('order');
    const token = searchParams.get('token');
    if (!orderId || !token || token !== process.env.SHOTSTACK_WEBHOOK_SECRET) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    if (!process.env.SHOTSTACK_API_KEY) return NextResponse.json({ error: 'Integração indisponível.' }, { status: 503 });
    const payload = await request.json();
    const renderId = payload?.response?.id || payload?.id;
    if (!renderId) return NextResponse.json({ error: 'Notificação sem render id.' }, { status: 400 });
    const db = adminClient();
    const { data: order, error: orderError } = await db.from('lyric_video_orders').select('id,owner_id,order_id,status,shotstack_render_id').eq('id', orderId).maybeSingle();
    if (orderError || !order) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    if (String(order.shotstack_render_id) !== String(renderId)) {
      console.warn('[lyric-video callback] render mismatch', { order_id: orderId, expected_render_id: order.shotstack_render_id, received_render_id: renderId });
      return NextResponse.json({ error: 'Render não corresponde ao pedido.' }, { status: 403 });
    }
    const verification = await fetch(`${shotstackBase()}/render/${encodeURIComponent(renderId)}`, { headers: { accept: 'application/json', 'x-api-key': process.env.SHOTSTACK_API_KEY } });
    const verified = await verification.json();
    const render = verified?.response;
    if (!verification.ok || !render?.id) throw new Error('Não foi possível confirmar o render na Shotstack.');
    const status = String(render.status || '').toLowerCase();
    if (status === 'done') {
      if (!render.url) throw new Error('A Shotstack concluiu o render sem disponibilizar a URL do vídeo.');
      const result = await completeAndDeliverVideo(db, order, render.url);
      return NextResponse.json({ ok: true, ...result });
    }
    const update = { updated_at: new Date().toISOString() };
    if (status === 'failed') Object.assign(update, { status: 'failed', error: render.error || render.message || 'A Shotstack não conseguiu renderizar este clipe.' });
    else Object.assign(update, { status: 'rendering', error: null });
    const { error } = await db.from('lyric_video_orders').update(update).eq('id', orderId).eq('shotstack_render_id', String(renderId));
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Falha ao processar callback.' }, { status: 500 });
  }
}
