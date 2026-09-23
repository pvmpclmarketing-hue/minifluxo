import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow, resolveMenuChoice } from '../../flow-engine';
import { appendChatMessage } from '../../chat-history';

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
      }
    }
    return NextResponse.json({ received: true, processed: results.length, results });
  } catch (error) {
    console.error('[datafy webhook] failed', { error: error?.message || String(error) });
    return NextResponse.json({ error: 'Falha ao processar webhook Datafy.' }, { status: 500 });
  }
}
