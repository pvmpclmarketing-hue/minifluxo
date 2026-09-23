import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow, resolveMenuChoice } from '../../flow-engine';
import { appendChatMessage } from '../../chat-history';
import { sendAudio } from '../../provider';

export const runtime = 'nodejs';

function signatureIsValid(rawBody, timestamp, signature) {
  const secret = String(process.env.DATAFY_WEBHOOK_SECRET || '');
  if (!secret || !/^\d+$/.test(String(timestamp || ''))) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const received = String(signature || '');
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function incomingText(message) {
  if (message?.type === 'text') return String(message.text?.body || '').trim();
  if (message?.type === 'interactive') return String(
    message.interactive?.button_reply?.id
      || message.interactive?.list_reply?.id
      || message.interactive?.button_reply?.title
      || message.interactive?.list_reply?.title
      || '',
  ).trim();
  return '';
}

async function trackDeliveryStatus(db,connection,status){
  const messageId=String(status?.id||'');if(!messageId)return {ignored:true,reason:'status_without_message_id'};
  const {data:leads,error}=await db.from('leads').select('id,owner_id,order_context').eq('connection_id',connection.id).order('updated_at',{ascending:false}).limit(500);
  if(error)throw error;
  const lead=(leads||[]).find(item=>Object.values(item.order_context?.delivery?.message_ids||{}).some(value=>String(value?.id||value)===messageId));
  if(!lead)return {ignored:true,reason:'audio_message_not_found'};
  const delivery=lead.order_context?.delivery||{};const message_statuses={...(delivery.message_statuses||{}),[messageId]:{status:String(status.status||'sent'),timestamp:status.timestamp?new Date(Number(status.timestamp)*1000).toISOString():new Date().toISOString(),recipient_id:String(status.recipient_id||''),errors:Array.isArray(status.errors)?status.errors.map(item=>({code:item.code,title:item.title,message:item.message})):[]}};
  const {error:updateError}=await db.from('leads').update({order_context:{...(lead.order_context||{}),delivery:{...delivery,message_statuses}},updated_at:new Date().toISOString()}).eq('id',lead.id).eq('owner_id',lead.owner_id).eq('connection_id',connection.id);
  if(updateError)throw updateError;
  return {tracked:true,lead_id:lead.id,status:message_statuses[messageId].status};
}

async function resumeMessage(db, connection, message, contact) {
  const phone = String(message?.from || contact?.wa_id || '').replace(/\D/g, '');
  const text = incomingText(message);
  if (!phone || !text) return { ignored: true, reason: 'unsupported_message' };
  const { data: latest } = await db.from('leads')
    .select('*').eq('connection_id', connection.id).eq('phone', phone)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!latest) return { ignored: true, reason: 'no_lead' };
  const existing=await appendChatMessage(db,latest,{id:message?.id,direction:'in',type:message?.type||'text',text,created_at:message?.timestamp?new Date(Number(message.timestamp)*1000).toISOString():undefined});
  if (existing.status!=='waiting_response') return { received: true, ignored: true, reason: 'no_waiting_flow' };

  const context = { ...(existing.order_context || {}), last_message: text };
  const execution = context.flow_execution || {};
  const { data: flow } = await db.from('flows').select('*').eq('id', execution.flow_id).eq('owner_id', existing.owner_id).maybeSingle();
  if (!flow?.status || flow.status !== 'active') return { ignored: true, reason: 'flow_unavailable' };

  // A resposta ao template aprovado abre a janela de 24 horas. Nesse caso o
  // fluxo precisa começar do início, sem interpretar a resposta como menu.
  if (execution.reengagement_template) {
    const retryIndexes = Array.isArray(execution.retry_delivery_indexes) ? execution.retry_delivery_indexes.filter(Number.isInteger) : [];
    if (retryIndexes.length) {
      const delivery = context.delivery || {}; const audios = Array.isArray(delivery.audios) ? delivery.audios : [];
      const sentIndexes = new Set(Array.isArray(delivery.sent_indexes) ? delivery.sent_indexes : []); const messageIds = { ...(delivery.message_ids || {}) };
      let retriedLead = existing;
      for (const index of retryIndexes) {
        if (!audios[index]) continue;
        const result = await sendAudio(connection, existing.phone, audios[index], `Música ${index + 1} de ${audios.length}`);
        const messageId = String(result?.messages?.[0]?.id || result?.data?.messages?.[0]?.id || `audio-retry-${index}-${Date.now()}`);
        messageIds[index] = { id: messageId, status: 'sent', sent_at: new Date().toISOString() };
        sentIndexes.add(index);
        retriedLead = await appendChatMessage(db, retriedLead, { id: messageId, direction: 'out', type: 'audio', url: audios[index], text: `🎵 Música ${index + 1} reenviada` });
      }
      const { error: retryError } = await db.from('leads').update({
        status: 'completed', order_context: { ...(retriedLead.order_context || {}), delivery: { ...delivery, audios, sent_indexes: [...sentIndexes], message_ids: messageIds }, flow_execution: null, reengagement: { ...(context.reengagement || {}), replied_at: new Date().toISOString(), delivery_retried_at: new Date().toISOString() } }, updated_at: new Date().toISOString(),
      }).eq('id', existing.id).eq('owner_id', existing.owner_id).eq('connection_id', connection.id).eq('status', 'waiting_response');
      if (retryError) throw retryError;
      return { received: true, resumed: 'blocked_delivery_retried' };
    }
    const { data: claimed } = await db.from('leads').update({
      status: 'in_progress', order_context: { ...context, flow_execution: null }, updated_at: new Date().toISOString(),
    }).eq('id', existing.id).eq('owner_id', existing.owner_id).eq('connection_id', connection.id).eq('status', 'waiting_response').select().maybeSingle();
    if (!claimed) return { ignored: true, reason: 'template_response_already_claimed' };
    return executeFlow({ db, flow, lead: claimed, connection });
  }

  let resumeAfterId = execution.wait_node_id;
  let resumeHandle = null;
  if (execution.menu_node_id) {
    const menuNode = (Array.isArray(flow.nodes) ? flow.nodes : []).find((node) => node.id === execution.menu_node_id);
    const choice = resolveMenuChoice(menuNode, text);
    if (choice.sourceHandle === 'other') return { ignored: true, reason: 'menu_choice_not_recognized' };
    const keys = choice.saveTo.split('.');
    const flowData = { ...(context.flow_data || {}) };
    let cursor = flowData;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) cursor[key] = choice.selection;
      else { cursor[key] = { ...(cursor[key] || {}) }; cursor = cursor[key]; }
    });
    context.flow_data = flowData;
    resumeAfterId = execution.menu_node_id;
    resumeHandle = choice.sourceHandle;
  }

  const { data: claimed } = await db.from('leads').update({
    status: 'in_progress', order_context: context, updated_at: new Date().toISOString(),
  }).eq('id', existing.id).eq('owner_id', existing.owner_id).eq('connection_id', connection.id).eq('status', 'waiting_response').select().maybeSingle();
  if (!claimed) return { ignored: true, reason: 'response_already_claimed' };
  return executeFlow({ db, flow, lead: claimed, connection, resumeAfterId, resumeHandle });
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    if (!signatureIsValid(rawBody, request.headers.get('x-datafy-timestamp'), request.headers.get('x-datafy-signature-256'))) return new NextResponse(null, { status: 401 });
    const payload = JSON.parse(rawBody);
    const db = adminClient();
    const phoneNumberId = String(process.env.DATAFY_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID || '');
    const { data: connections } = await db.from('connections').select('*').eq('provider', 'meta').eq('status', 'connected').limit(2);
    if ((connections || []).length !== 1) return NextResponse.json({ received: true, ignored: true, reason: 'official_connection_unavailable' });
    const connection = connections[0];
    const results = [];
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const value = change?.value || {};
        if (phoneNumberId && value.metadata?.phone_number_id && String(value.metadata.phone_number_id) !== phoneNumberId) continue;
        const contact = Array.isArray(value.contacts) ? value.contacts[0] : null;
        for (const message of Array.isArray(value.messages) ? value.messages : []) results.push(await resumeMessage(db, connection, message, contact));
        for (const status of Array.isArray(value.statuses) ? value.statuses : []) results.push(await trackDeliveryStatus(db, connection, status));
      }
    }
    return NextResponse.json({ received: true, processed: results.length, results });
  } catch (error) {
    console.error('[datafy webhook] failed', { error: error?.message || String(error) });
    return NextResponse.json({ error: 'Falha ao processar webhook Datafy.' }, { status: 500 });
  }
}
