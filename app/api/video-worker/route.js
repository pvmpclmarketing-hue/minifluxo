import { NextResponse } from 'next/server';
import { adminClient } from '../supabase';
import { sendMedia } from '../provider';
import { executeFlow } from '../flow-engine';

export const dynamic = 'force-dynamic';

function authorized(request) {
  const token = process.env.VIDEO_WORKER_TOKEN;
  return Boolean(token) && request.headers.get('authorization') === `Bearer ${token}`;
}

function reply(data, status = 200) { return NextResponse.json(data, { status }); }

async function deliverCompletedPair(db, order, { retry = false } = {}) {
  if (!order.lead_id || !order.flow_node_id) return { delivery: 'not_applicable' };
  const { data: pair, error: pairError } = await db.from('video_orders')
    .select('id,output_url,status,variant_index').eq('lead_id', order.lead_id).eq('flow_node_id', order.flow_node_id)
    .order('variant_index', { ascending: true });
  if (pairError) throw pairError;
  if ((pair || []).length !== 2 || pair.some(item => item.status !== 'complete' || !item.output_url)) return { delivery: 'awaiting_pair' };

  // Only one of the two completion callbacks may claim WhatsApp delivery.
  const eligibleStatuses = retry ? ['generating_video', 'completed', 'delivery_failed'] : ['generating_video'];
  const { data: lead, error: leadError } = await db.from('leads').update({
    status: 'delivering', updated_at: new Date().toISOString(),
  }).eq('id', order.lead_id).eq('owner_id', order.owner_id).in('status', eligibleStatuses).select().maybeSingle();
  if (leadError) throw leadError;
  if (!lead) return { delivery: 'already_processing' };

  try {
    const [{ data: connection }, { data: flow }] = await Promise.all([
      db.from('connections').select('*').eq('id', lead.connection_id).eq('owner_id', lead.owner_id).eq('status', 'connected').maybeSingle(),
      db.from('flows').select('*').eq('id', lead.order_context?.flow_execution?.flow_id).eq('owner_id', lead.owner_id).eq('status', 'active').maybeSingle(),
    ]);
    if (!connection) throw new Error('O WhatsApp do pedido não está conectado para entregar os vídeos.');
    // A entrega do produto não pode depender de existir um próximo card. Um
    // teste, fluxo arquivado ou término natural ainda precisa receber o vídeo.
    for (const item of pair) await sendMedia(connection, lead.phone, 'video', item.output_url, `💖 Seu lyric video — versão ${item.variant_index} está pronto!`);
    const execution=lead.order_context?.flow_execution||{};
    const videos=lead.order_context?.flow_data?.lyric_videos||{};
    const saved=videos[order.flow_node_id]||{};
    const deliveredContext={...lead.order_context,flow_data:{...(lead.order_context?.flow_data||{}),lyric_videos:{...videos,[order.flow_node_id]:{...saved,status:'complete',videos:pair.map(item=>({order_id:item.id,variant_index:item.variant_index,output_url:item.output_url})),sent_at:new Date().toISOString()}}},flow_execution:execution};
    const deliveryStatus = flow ? 'in_progress' : 'completed';
    const { data: deliveredLead, error: deliveredError } = await db.from('leads').update({ status:deliveryStatus,order_context:deliveredContext,updated_at:new Date().toISOString() }).eq('id', lead.id).eq('owner_id', lead.owner_id).eq('status','delivering').select().single();
    if (deliveredError) throw deliveredError;
    if (flow) {
      await executeFlow({ db, flow, lead: deliveredLead, connection, resumeAfterId: order.flow_node_id });
      return { delivery: 'sent_and_flow_resumed' };
    }
    return { delivery: 'sent' };
  } catch (error) {
    await db.from('leads').update({ status:'delivery_failed',order_context:{...(lead.order_context||{}),video_delivery_error:String(error?.message||error),flow_execution:{...(lead.order_context?.flow_execution||{}),state:'video_delivery_failed'}},updated_at:new Date().toISOString() }).eq('id', lead.id).eq('owner_id', lead.owner_id).eq('status','delivering');
    throw error;
  }
}

export async function POST(request) {
  if (!authorized(request)) return reply({ error: 'Não autorizado.' }, 401);
  try {
    const body = await request.json();
    const db = adminClient();

    if (body.action === 'claim-order') {
      const orderId = String(body.orderId || '');
      if (!orderId) return reply({ error: 'orderId é obrigatório.' }, 400);
      const { data: current, error: currentError } = await db.from('video_orders').select('*').eq('id', orderId).maybeSingle();
      if (currentError) throw currentError;
      const stale = current?.status === 'processing' && current.locked_at
        && Date.now() - new Date(current.locked_at).getTime() > 5 * 60 * 1000;
      if (!current || (!['pending', ...(stale ? ['processing'] : [])].includes(current.status)) || Number(current.attempts || 0) >= 3) {
        return reply({ order: null, reason: current?.status === 'complete' ? 'complete' : 'unavailable' });
      }
      const { data: claimed, error: claimError } = await db.from('video_orders').update({
        status: 'processing', attempts: Number(current.attempts || 0) + 1, locked_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null,
      }).eq('id', orderId).eq('status', current.status).eq('attempts', current.attempts).select().maybeSingle();
      if (claimError) throw claimError;
      return reply({ order: claimed || null });
    }

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
      const { data: order, error } = await db.from('video_orders').select('audio_url,photos,background_url').eq('id', orderId).single();
      if (error || !order) throw error || new Error('Pedido não encontrado.');
      const sign = async (value) => {
        if (!value.startsWith('storage://video-inputs/')) return value;
        const path = value.slice('storage://video-inputs/'.length);
        const { data, error: signError } = await db.storage.from('video-inputs').createSignedUrl(path, 3600);
        if (signError || !data?.signedUrl) throw signError || new Error('Não foi possível assinar o arquivo.');
        return data.signedUrl;
      };
      return reply({ audioUrl: await sign(order.audio_url), photoUrls: await Promise.all(order.photos.map(sign)), backgroundUrl: order.background_url ? await sign(order.background_url) : null });
    }

    if (body.action === 'upload-url') {
      const path = `videos/${orderId}/music-video.mp4`;
      const { data, error } = await db.storage.from('video-outputs').createSignedUploadUrl(path, { upsert: true });
      if (error || !data?.signedUrl) throw error || new Error('Não foi possível criar o envio do vídeo.');
      const { data: publicData } = db.storage.from('video-outputs').getPublicUrl(path);
      return reply({ uploadUrl: data.signedUrl, publicUrl: publicData.publicUrl });
    }

    if (body.action === 'complete') {
      const { data: order, error } = await db.from('video_orders').update({ status: 'complete', output_url: body.outputUrl, error: null, updated_at: new Date().toISOString() }).eq('id', orderId).select('*').single();
      if (error || !order) throw error || new Error('Pedido não encontrado.');
      return reply({ ok: true, ...(await deliverCompletedPair(db, order)) });
    }

    if (body.action === 'redeliver') {
      const { data: order, error } = await db.from('video_orders').select('*').eq('id', orderId).single();
      if (error || !order) throw error || new Error('Pedido não encontrado.');
      if (order.status !== 'complete' || !order.output_url) return reply({ error: 'O vídeo ainda não está pronto para reentrega.' }, 409);
      return reply({ ok: true, ...(await deliverCompletedPair(db, order, { retry: true })) });
    }

    return reply({ error: 'Ação inválida.' }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Erro interno.' }, 500);
  }
}
