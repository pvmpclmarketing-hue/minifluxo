import { createHmac, timingSafeEqual } from 'crypto';
import { after, NextResponse } from 'next/server';
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
  // Algumas integrações encaminham respostas rápidas como `button` em vez
  // do formato `interactive` da Cloud API. Aceitar ambas evita que um clique
  // legítimo no template seja salvo como uma mensagem vazia.
  if (message?.type === 'button') return String(message.button?.payload || message.button?.text || '').trim();
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
  const {data:leads,error}=await db.from('leads').select('*').eq('connection_id',connection.id).order('updated_at',{ascending:false}).limit(500);
  if(error)throw error;
  const lead=(leads||[]).find(item=>Object.values(item.order_context?.delivery?.message_ids||{}).some(value=>String(value?.id||value)===messageId));
  if(!lead)return {ignored:true,reason:'flow_message_not_found'};
  const delivery=lead.order_context?.delivery||{};
  const receivedStatus=String(status.status||'sent');
  const message_statuses={...(delivery.message_statuses||{}),[messageId]:{status:receivedStatus,timestamp:status.timestamp?new Date(Number(status.timestamp)*1000).toISOString():new Date().toISOString(),recipient_id:String(status.recipient_id||''),errors:Array.isArray(status.errors)?status.errors.map(item=>({code:item.code,title:item.title,message:item.message})):[]}};
  const {data:updatedLead,error:updateError}=await db.from('leads').update({order_context:{...(lead.order_context||{}),delivery:{...delivery,message_statuses}},updated_at:new Date().toISOString()}).eq('id',lead.id).eq('owner_id',lead.owner_id).eq('connection_id',connection.id).select().single();
  if(updateError)throw updateError;

  // Um vídeo com próximo card mantém o fluxo parado até o recibo "delivered"
  // (ou "read") da API oficial. "sent" só confirma que a Meta aceitou a
  // solicitação; ainda não prova que o vídeo chegou ao WhatsApp do cliente.
  // O claim pelo status impede que recibos posteriores reiniciem o trecho.
  const execution=updatedLead.order_context?.flow_execution||{};
  const videoReady=execution.wait_for_media_delivery&&String(execution.media_message_id||'')===messageId&&['delivered','read'].includes(receivedStatus);
  if(!videoReady||updatedLead.status!=='waiting_media_delivery')return {tracked:true,lead_id:updatedLead.id,status:receivedStatus};
  const {data:flow}=await db.from('flows').select('*').eq('id',execution.flow_id).eq('owner_id',updatedLead.owner_id).eq('status','active').maybeSingle();
  if(!flow)return {tracked:true,lead_id:updatedLead.id,status:receivedStatus,ignored:'flow_unavailable'};
  const {data:claimed,error:claimError}=await db.from('leads').update({status:'in_progress',order_context:{...(updatedLead.order_context||{}),flow_execution:null,media_delivery:{message_id:messageId,status:receivedStatus,resumed_at:new Date().toISOString()}},updated_at:new Date().toISOString()}).eq('id',updatedLead.id).eq('owner_id',updatedLead.owner_id).eq('connection_id',connection.id).eq('status','waiting_media_delivery').select().maybeSingle();
  if(claimError)throw claimError;
  if(!claimed)return {tracked:true,lead_id:updatedLead.id,status:receivedStatus,ignored:'video_receipt_already_claimed'};
  const result=await executeFlow({db,flow,lead:claimed,connection,resumeAfterId:execution.media_node_id});
  return {tracked:true,lead_id:updatedLead.id,status:receivedStatus,flow_resumed:true,result};
}

async function resumeMessage(db, connection, message, contact) {
  const phone = String(message?.from || contact?.wa_id || '').replace(/\D/g, '');
  const text = incomingText(message);
  if (!phone) return { ignored: true, reason: 'message_without_phone' };
  // A Meta pode devolver um celular brasileiro sem o nono dígito em alguns
  // eventos antigos. Buscamos somente as duas representações equivalentes,
  // sempre dentro da conexão oficial ativa, para não associar conversas de
  // números internacionais ou de outra conta.
  const phoneCandidates = /^55\d{10}$/.test(phone)
    ? [phone, `${phone.slice(0, 4)}9${phone.slice(4)}`]
    : (/^55\d{11}$/.test(phone) ? [phone, `${phone.slice(0, 4)}${phone.slice(5)}`] : [phone]);
  const { data: candidates } = await db.from('leads')
    .select('*').eq('connection_id', connection.id).in('phone', phoneCandidates)
    .order('updated_at', { ascending: false }).limit(2);
  const latest = (candidates || [])[0];
  if (!latest) return { ignored: true, reason: 'no_lead' };
  // Para a resposta ao template, qualquer interação abre a janela de 24h:
  // texto, botão, áudio, imagem, documento ou figurinha. Preservamos um
  // marcador legível no chat quando a mensagem não tem corpo textual.
  const messageType = String(message?.type || 'text');
  const messageText = text || `[${messageType} recebido]`;
  const existing=await appendChatMessage(db,latest,{id:message?.id,direction:'in',type:messageType,text:messageText,created_at:message?.timestamp?new Date(Number(message.timestamp)*1000).toISOString():undefined});
  // O timeout serve para impedir novos envios automáticos, mas não pode
  // descartar uma resposta humana ao template aprovado. Ao responder, a
  // própria Meta abre a janela de 24 horas; por isso reabrimos apenas leads
  // que ainda têm um checkpoint de fluxo, nunca um lead expirado aleatório.
  const resumableStatus = ['waiting_response', 'timed_out'];
  if (!resumableStatus.includes(existing.status) || !existing.order_context?.flow_execution?.flow_id) {
    return { received: true, ignored: true, reason: 'no_waiting_flow' };
  }

  const context = { ...(existing.order_context || {}), last_message: text };
  const execution = context.flow_execution || {};
  const { data: flow } = await db.from('flows').select('*').eq('id', execution.flow_id).eq('owner_id', existing.owner_id).maybeSingle();
  if (!flow?.status || flow.status !== 'active') return { ignored: true, reason: 'flow_unavailable' };

  // A resposta ao template aprovado abre a janela de 24 horas. Nesse caso o
  // fluxo sempre começa do início, sem interpretar a resposta como menu. Não
  // reenviamos mídia isolada: isso pularia os cards e quebraria a sequência.
  if (execution.reengagement_template) {
    // A tentativa anterior pode ter salvo as faixas como "enviadas" mesmo se
    // uma delas falhou ou se a conversa foi interrompida. Como este é um novo
    // ciclo iniciado pelo template, zere apenas o progresso de entrega para
    // que o card "Entregar música" envie novamente as duas faixas na ordem do
    // fluxo. Mantemos os URLs e os recibos históricos para auditoria.
    const previousDelivery = context.delivery || {};
    const restartedDelivery = {
      ...previousDelivery,
      sent_indexes: [],
      intro_sent: false,
      message_ids: {},
      restarted_at: new Date().toISOString(),
      previous_message_ids: previousDelivery.message_ids || {},
    };
    const { data: claimed } = await db.from('leads').update({
      status: 'in_progress', order_context: { ...context, delivery: restartedDelivery, flow_execution: null, reengagement: { ...(context.reengagement || {}), replied_at: new Date().toISOString(), flow_restarted_at: new Date().toISOString() } }, updated_at: new Date().toISOString(),
    }).eq('id', existing.id).eq('owner_id', existing.owner_id).eq('connection_id', connection.id).in('status', resumableStatus).select().maybeSingle();
    if (!claimed) return { ignored: true, reason: 'template_response_already_claimed' };
    return executeFlow({ db, flow, lead: claimed, connection });
  }

  // Fora da etapa de template, fluxos com menus continuam aceitando apenas
  // texto ou respostas interativas que possam ser associadas a uma escolha.
  if (!text) return { received: true, ignored: true, reason: 'unsupported_message_for_menu' };

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
  }).eq('id', existing.id).eq('owner_id', existing.owner_id).eq('connection_id', connection.id).in('status', resumableStatus).select().maybeSingle();
  if (!claimed) return { ignored: true, reason: 'response_already_claimed' };
  return executeFlow({ db, flow, lead: claimed, connection, resumeAfterId, resumeHandle });
}

export async function POST(request) {
  let payload;
  try {
    const rawBody = await request.text();
    if (!signatureIsValid(rawBody, request.headers.get('x-datafy-timestamp'), request.headers.get('x-datafy-signature-256'))) return new NextResponse(null, { status: 401 });
    payload = JSON.parse(rawBody);
  } catch (error) {
    console.error('[datafy webhook] rejected', { error: error?.message || String(error) });
    return NextResponse.json({ error: 'Webhook Datafy inválido.' }, { status: 400 });
  }

  // A Datafy exige um 200 em até 20s e reenfileira apenas três vezes. Criar
  // música, assinar mídia e avançar cards pode levar mais que isso; portanto
  // confirmamos a entrega imediatamente e executamos o fluxo depois da
  // resposta. O checkpoint condicional do lead mantém idempotência se a
  // plataforma repetir o mesmo evento durante uma falha transitória.
  after(async () => {
    try {
      const db = adminClient();
    const phoneNumberId = String(process.env.DATAFY_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID || '');
    const { data: connections } = await db.from('connections').select('*').eq('provider', 'meta').eq('status', 'connected').limit(2);
    if ((connections || []).length !== 1) {
      console.warn('[datafy webhook] ignored', { reason: 'official_connection_unavailable', connection_count: (connections || []).length });
      return;
    }
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
    console.info('[datafy webhook] processed', { processed: results.length, results: results.map((result) => result?.reason || result?.lead_id || 'ok') });
  } catch (error) {
    console.error('[datafy webhook] failed', { error: error?.message || String(error) });
  }});
  return NextResponse.json({ received: true, queued: true });
}
