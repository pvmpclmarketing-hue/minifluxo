import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { sendText } from '../../provider';
import { executeFlow } from '../../flow-engine';

async function resolveConnection(db, body) {
  if (body.integration_key) {
    const { data: integration } = await db.from('site_integrations').select('connection_id').eq('integration_key', body.integration_key).maybeSingle();
    if (integration?.connection_id) return (await db.from('connections').select('*').eq('id', integration.connection_id).maybeSingle()).data;
    return (await db.from('connections').select('*').eq('site_integration_key', body.integration_key).maybeSingle()).data;
  }
  if (body.connection_id) return (await db.from('connections').select('*').eq('id', body.connection_id).maybeSingle()).data;
  return null;
}

function urlsFrom(value, result = new Set()) {
  if (!value) return result;
  if (Array.isArray(value)) {
    value.forEach((item) => urlsFrom(item, result));
    return result;
  }
  if (typeof value === 'string') {
    value.split(/[\s,]+/).filter((item) => /^https?:\/\//i.test(item)).forEach((item) => result.add(item));
    return result;
  }
  if (typeof value === 'object') Object.values(value).forEach((item) => urlsFrom(item, result));
  return result;
}

function previewAudios(body) {
  const candidates = [
    body.preview_audios, body.previewAudios, body.preview_audio_urls, body.previewAudioUrls,
    body.audio_urls, body.audioUrls, body.tracks,
    body.preview?.audios, body.preview?.audio_urls, body.preview?.audioUrls,
    body.music?.audios, body.music?.audio_urls, body.music?.audioUrls,
    body.kie?.audios, body.kie?.audio_urls, body.kie?.audioUrls,
  ];
  return [...urlsFrom(candidates)].slice(0, 2);
}

export async function POST(request) {
  try {
    if (!process.env.PAYMENT_WEBHOOK_SECRET || request.headers.get('x-payment-secret') !== process.env.PAYMENT_WEBHOOK_SECRET) return new NextResponse(null, { status: 401 });
    const body = await request.json();
    if (body.event !== 'PAYMENT_APPROVED') return NextResponse.json({ received: true, ignored: true });
    if (!body.customer?.name || !body.customer?.phone) return NextResponse.json({ error: 'customer.name e customer.phone sao obrigatorios.' }, { status: 400 });

    const db = adminClient();
    const connection = await resolveConnection(db, body);
    if (!connection) return NextResponse.json({ error: 'Informe uma integration_key valida.' }, { status: 400 });
    const { data: config, error: configError } = await db.from('connection_flow_configs').select('payment_flow_id,owner_id').eq('connection_id', connection.id).single();
    if (configError || !config?.payment_flow_id) return NextResponse.json({ error: 'Nenhum fluxo de pagamento configurado para esta conexao.' }, { status: 404 });
    const { data: flow, error: flowError } = await db.from('flows').select('id,owner_id').eq('id', config.payment_flow_id).eq('owner_id', config.owner_id).single();
    if (flowError || !flow) return NextResponse.json({ error: 'Fluxo configurado nao encontrado.' }, { status: 404 });

    const phone = String(body.customer.phone).replace(/\D/g, '');
    const audios = previewAudios(body);
    const musicRequest = body.music_request || body.custom_fields?.story || body.custom_fields?.music_style || body.story || body.lyric_text || null;
    const orderContext = {
      quiz: body.quiz || body.custom_fields?.quiz || {},
      story: body.story || '',
      lyricText: body.lyric_text || '',
      paid: true,
      sourceOrderId: body.order_id || body.orderId || null,
      preview_audios: audios,
      preview_task_id: body.preview?.task_id || body.preview?.taskId || body.kie_task_id || null,
    };
    const leadValues = { name: body.customer.name, phone, music_request: musicRequest, status: audios.length ? 'in_progress' : 'generating', connection_id: connection.id, order_context: orderContext, updated_at: new Date().toISOString() };
    let lead;
    if (orderContext.sourceOrderId) {
      const { data: existing } = await db.from('leads').select('id').eq('owner_id', flow.owner_id).eq('external_order_id', orderContext.sourceOrderId).maybeSingle();
      if (existing) {
        const { data, error } = await db.from('leads').update(leadValues).eq('id', existing.id).select().single();
        if (error) throw error;
        lead = data;
      }
    }
    if (!lead) {
      const { data, error } = await db.from('leads').insert({ owner_id: flow.owner_id, source: 'payment', provider: 'payment', external_order_id: orderContext.sourceOrderId, ...leadValues }).select().single();
      if (error) throw error;
      lead = data;
    }
    if (connection.status === 'connected') {
      const { data: executionFlow } = await db.from('flows').select('*').eq('id', config.payment_flow_id).eq('owner_id', config.owner_id).maybeSingle();
      if (executionFlow?.status === 'active') await executeFlow({ db, flow: executionFlow, lead, connection, audios });
      else await sendText(connection, phone, `Pagamento confirmado, ${body.customer.name}! Sua musica entrou na fila de criacao.`);
    }
    return NextResponse.json({ received: true, execution_id: lead.id, preview_tracks: audios.length });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
