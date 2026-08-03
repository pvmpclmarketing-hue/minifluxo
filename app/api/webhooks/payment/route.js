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
    body.quiz?.preview_audio_urls, body.quiz?.previewAudios,
    body.music?.audios, body.music?.audio_urls, body.music?.audioUrls,
    body.kie?.audios, body.kie?.audio_urls, body.kie?.audioUrls,
  ];
  return [...urlsFrom(candidates)].slice(0, 2);
}

function fulfillmentMode(body) {
  return body.fulfillment?.mode || body.quiz?.fulfillment_mode || null;
}

export async function POST(request) {
  let stage = 'authorization';
  try {
    if (!process.env.PAYMENT_WEBHOOK_SECRET || request.headers.get('x-payment-secret') !== process.env.PAYMENT_WEBHOOK_SECRET) return new NextResponse(null, { status: 401 });
    stage = 'payload_validation';
    const body = await request.json();
    if (body.event !== 'PAYMENT_APPROVED') return NextResponse.json({ received: true, ignored: true });
    if (!body.customer?.name || !body.customer?.phone) return NextResponse.json({ error: 'customer.name e customer.phone sao obrigatorios.' }, { status: 400 });
    const mode = fulfillmentMode(body);
    if (!['deliver_existing_preview_audio', 'generate_music_in_miniflux'].includes(mode)) return NextResponse.json({ error: 'fulfillment.mode deve ser deliver_existing_preview_audio ou generate_music_in_miniflux.' }, { status: 400 });
    const orderId = body.order_id || body.orderId || null;
    if (!orderId) return NextResponse.json({ error: 'order_id e obrigatorio para evitar disparos duplicados.' }, { status: 400 });

    stage = 'connection_resolution';
    const db = adminClient();
    const connection = await resolveConnection(db, body);
    if (!connection) return NextResponse.json({ error: 'Informe uma integration_key valida.' }, { status: 400 });
    stage = 'flow_configuration';
    const { data: config, error: configError } = await db.from('connection_flow_configs').select('payment_preview_flow_id,payment_generation_flow_id,owner_id').eq('connection_id', connection.id).single();
    if (config?.owner_id !== connection.owner_id) return NextResponse.json({ error: 'A configuração não pertence à conta desta conexão.' }, { status: 403 });
    const flowId = mode === 'deliver_existing_preview_audio' ? config?.payment_preview_flow_id : config?.payment_generation_flow_id;
    if (configError || !flowId) return NextResponse.json({ error: mode === 'deliver_existing_preview_audio' ? 'Nenhum fluxo de pagamento com prévia pronta está configurado para esta conexão.' : 'Nenhum fluxo de pagamento sem prévia está configurado para esta conexão.' }, { status: 404 });
    const { data: flow, error: flowError } = await db.from('flows').select('id,owner_id').eq('id', flowId).eq('owner_id', config.owner_id).single();
    if (flowError || !flow) return NextResponse.json({ error: 'Fluxo configurado nao encontrado.' }, { status: 404 });

    const phone = String(body.customer.phone).replace(/\D/g, '');
    const previewTracks = previewAudios(body);
    if (mode === 'deliver_existing_preview_audio' && previewTracks.length !== 2) return NextResponse.json({ error: 'A entrega da previa exige exatamente duas URLs em preview.audios.' }, { status: 422 });
    const audios = mode === 'deliver_existing_preview_audio' ? previewTracks : [];
    const musicRequest = body.music_request || body.custom_fields?.story || body.custom_fields?.music_style || body.story || body.lyric_text || null;
    if (mode === 'generate_music_in_miniflux' && !body.lyric_text && !body.lyricText) return NextResponse.json({ error: 'lyric_text e obrigatorio para gerar a musica no WhatsEntregavel.' }, { status: 400 });
    const orderContext = {
      quiz: body.quiz || body.custom_fields?.quiz || {},
      story: body.story || '',
      lyricText: body.lyric_text || '',
      paid: true,
      sourceOrderId: orderId,
      idempotency_key: body.idempotency_key || `payment:${orderId}`,
      fulfillment_mode: mode,
      preview_audios: audios,
      preview_task_id: body.preview?.task_id || body.preview?.taskId || body.kie_task_id || null,
    };
    // A geração só passa a ser "generating" depois que a Kie devolve um taskId.
    // Antes disso o pedido pode ser reenviado com segurança caso uma etapa falhe.
    const leadValues = { name: body.customer.name, phone, music_request: musicRequest, status: 'in_progress', connection_id: connection.id, order_context: orderContext, updated_at: new Date().toISOString() };
    let lead;
    stage = 'idempotency_check';
    if (orderContext.sourceOrderId) {
      const { data: existing } = await db.from('leads').select('id,status,kie_task_id,order_context').eq('owner_id', flow.owner_id).eq('external_order_id', orderContext.sourceOrderId).maybeSingle();
      if (existing) {
        const execution = existing.order_context?.flow_execution || {};
        const isWaiting = Boolean(execution.wait_node_id || execution.delay_node_id || execution.kie_node_id);
        const retryable = !existing.kie_task_id && !isWaiting && ['new', 'in_progress', 'generating', 'failed', 'error'].includes(existing.status);
        if (!retryable) return NextResponse.json({ received: true, duplicate: true, execution_id: existing.id, status: existing.status });
        const { data, error } = await db.from('leads').update(leadValues).eq('id', existing.id).select().single();
        if (error) throw error;
        lead = data;
      }
    }
    stage = 'create_lead';
    if (!lead) {
      const { data, error } = await db.from('leads').insert({ owner_id: flow.owner_id, source: 'payment', provider: 'payment', external_order_id: orderContext.sourceOrderId, ...leadValues }).select().single();
      if (error) throw error;
      lead = data;
    }
    stage = 'execute_flow';
    if (connection.status === 'connected') {
      const { data: executionFlow } = await db.from('flows').select('*').eq('id', flowId).eq('owner_id', config.owner_id).maybeSingle();
      if (executionFlow?.status === 'active') {
        const result = await executeFlow({ db, flow: executionFlow, lead, connection, audios });
        console.info('[payment webhook] flow execution finished', { lead_id: lead.id, result });
      }
      else await sendText(connection, phone, `Pagamento confirmado, ${body.customer.name}! Sua musica entrou na fila de criacao.`);
    }
    return NextResponse.json({ received: true, execution_id: lead.id, flow_id: flowId, fulfillment_mode: mode, preview_tracks: audios.length });
  } catch (error) {
    console.error('[payment webhook] failed', { stage, error: error?.message || String(error) });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
