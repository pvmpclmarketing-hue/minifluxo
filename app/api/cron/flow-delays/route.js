import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow, recoverKieGeneration, retryKieDelivery } from '../../flow-engine';
import { sendTemplate } from '../../provider';
import { appendChatMessage } from '../../chat-history';

export async function POST(request) {
  // Em instalações antigas o segredo exclusivo do cron pode não existir. O
  // segredo do webhook de pagamentos continua sendo uma credencial privada de
  // servidor e permite que a recuperação automática permaneça protegida.
  const receivedAuthorization = request.headers.get('authorization');
  const acceptedSecrets = [process.env.CRON_SECRET, process.env.DELAY_CRON_SECRET, process.env.PAYMENT_WEBHOOK_SECRET]
    .filter(Boolean)
    .map((secret) => `Bearer ${secret}`);
  if (!acceptedSecrets.length || !acceptedSecrets.includes(receivedAuthorization)) return new NextResponse(null, { status: 401 });
  const db = adminClient();
  const now = Date.now();
  const timeoutHours = Math.max(1, Number(process.env.FLOW_EXECUTION_TIMEOUT_HOURS || 24));
  const timeoutAt = new Date(now - timeoutHours * 60 * 60 * 1000).toISOString();
  // Estas etapas deveriam avançar sem uma nova ação do cliente. Se ficarem presas,
  // encerramos somente esta execução para que ela nunca volte a enviar mensagens depois.
  const { data: expired, error: expireError } = await db.from('leads').update({ status: 'timed_out', updated_at: new Date().toISOString() }).in('status', ['in_progress', 'generating', 'generating_video', 'delivering', 'delivery_failed', 'waiting_response', 'waiting_payment', 'waiting_pix', 'waiting_delay']).lt('updated_at', timeoutAt).select('id');
  if (expireError) return NextResponse.json({ error: expireError.message }, { status: 500 });
  const { data: pending, error } = await db.from('leads').select('*').eq('status', 'waiting_delay').limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let resumed = 0; let remarketingDispatched = 0; let recoveredKie = 0; let stopped = expired?.length || 0;
  let reengagementTemplatesSent = 0;
  // A Meta pode aceitar o envio da mídia e, em seguida, recusá-lo por ela
  // estar fora da janela de 24 horas. Reabre automaticamente só esses casos
  // com o template aprovado, sem tocar em entregas já aceitas.
  const { data: responseWaiters, error: responseWaitersError } = await db.from('leads').select('*').eq('status', 'waiting_response').limit(200);
  if (responseWaitersError) return NextResponse.json({ error: responseWaitersError.message }, { status: 500 });
  for (const item of responseWaiters || []) {
    const context = item.order_context || {}; const delivery = context.delivery || {};
    const failedIndexes = Object.entries(delivery.message_ids || {}).filter(([, value]) => {
      const status = delivery.message_statuses?.[String(value?.id || value)];
      return status?.status === 'failed' && (status.errors || []).some((error) => Number(error?.code) === 131047);
    }).map(([index]) => Number(index)).filter(Number.isInteger);
    if (!context.paid || !failedIndexes.length || context.reengagement?.template_sent_at) continue;
    try {
      const { data: connection } = await db.from('connections').select('*').eq('id', item.connection_id).eq('owner_id', item.owner_id).eq('provider', 'meta').eq('status', 'connected').maybeSingle();
      const flowId = context.flow_execution?.flow_id;
      if (!connection || !flowId) continue;
      const result = await sendTemplate(connection, item.phone, process.env.WHATSAPP_PAYMENT_TEMPLATE_NAME || 'flow', process.env.WHATSAPP_PAYMENT_TEMPLATE_LANGUAGE || 'en_US');
      const messageId = String(result?.messages?.[0]?.id || result?.data?.messages?.[0]?.id || `template-${Date.now()}`);
      const withHistory = await appendChatMessage(db, item, { id: messageId, direction: 'out', type: 'text', text: 'Olá! Tudo bem? 😊\n\nPosso enviar sua música? Me responda que já inicio o processo!' });
      const { error: updateError } = await db.from('leads').update({
        order_context: { ...(withHistory.order_context || {}), reengagement: { ...(context.reengagement || {}), template_sent_at: new Date().toISOString(), template_message_id: messageId }, flow_execution: { ...(context.flow_execution || {}), reengagement_template: true, retry_delivery_indexes: failedIndexes } },
        updated_at: new Date().toISOString(),
      }).eq('id', item.id).eq('owner_id', item.owner_id).eq('status', 'waiting_response');
      if (updateError) throw updateError;
      reengagementTemplatesSent += 1;
    } catch (templateError) { console.error('[reengagement template] failed', { leadId: item.id, error: templateError.message }); }
  }
  // Se o webhook de pagamento falhar entre criar o lead e iniciar a Kie, o
  // pedido fica pago, com letra, porém sem checkpoint nem taskId. Retomamos
  // exclusivamente esse estado inicial; isso não repete fluxos aguardando
  // resposta/Pix e nem músicas que já começaram a ser geradas.
  let recoveredUnstarted = 0;
  const recoveryCutoff = new Date(now - 2 * 60 * 1000).toISOString();
  const { data: unstartedPayments, error: unstartedError } = await db.from('leads')
    .select('*')
    .eq('status', 'in_progress')
    // Um pagamento vindo do site Efí começa como `source: site` e é
    // promovido pelo webhook. Incluí-lo aqui torna a recuperação idêntica à
    // dos pagamentos Asaas caso a confirmação tenha sido gravada mas a
    // execução do fluxo não tenha começado.
    .in('source', ['payment', 'site', 'site_remarketing'])
    .lt('updated_at', recoveryCutoff)
    .limit(50);
  if (unstartedError) return NextResponse.json({ error: unstartedError.message }, { status: 500 });
  for (const item of unstartedPayments || []) {
    const context = item.order_context || {};
    // Alguns webhooks antigos gravaram um objeto vazio como checkpoint. Isso
    // não representa uma execução iniciada e deve poder ser retomado.
    const hasFlowExecution = Boolean(context.flow_execution && Object.keys(context.flow_execution).length);
    if (!context.paid || context.fulfillment_mode !== 'generate_music_in_miniflux' || hasFlowExecution || item.kie_task_id || item.music_url || !String(context.lyricText || '').trim()) continue;
    try {
      let connection = null;
      if (item.connection_id) {
        const { data: original } = await db.from('connections').select('*').eq('id', item.connection_id).eq('owner_id', item.owner_id).eq('status', 'connected').maybeSingle();
        connection = original;
      }
      // Só migra para outra conexão quando há exatamente um WhatsApp ativo na
      // conta; com dois números não é seguro adivinhar o destinatário.
      if (!connection) {
        const { data: connections } = await db.from('connections').select('*').eq('owner_id', item.owner_id).eq('status', 'connected').order('created_at', { ascending: false }).limit(2);
        if ((connections || []).length !== 1) continue;
        connection = connections[0];
      }
      const { data: config } = await db.from('connection_flow_configs').select('payment_generation_flow_id,owner_id').eq('connection_id', connection.id).maybeSingle();
      if (!config?.payment_generation_flow_id || config.owner_id !== item.owner_id) continue;
      const { data: flow } = await db.from('flows').select('*').eq('id', config.payment_generation_flow_id).eq('owner_id', item.owner_id).eq('status', 'active').maybeSingle();
      if (!flow) continue;
      // A conexão cadastrada no Pix pode ter sido removida ou trocada entre o
      // pagamento e a recuperação. O lead continua sendo o mesmo pedido e a
      // conta já foi validada acima; portanto, reivindicamos pelo estado do
      // pedido e migramos para a única conexão ativa, em vez de abandoná-lo.
      const claim = db.from('leads').update({
        connection_id: connection.id,
        provider: connection.provider,
        order_context: { ...context, flow_execution: { flow_id: flow.id, recovered_unstarted_payment_at: new Date().toISOString() } },
        updated_at: new Date().toISOString(),
      }).eq('id', item.id).eq('owner_id', item.owner_id).eq('status', 'in_progress').is('kie_task_id', null);
      const { data: claimed } = await claim.select().maybeSingle();
      if (!claimed) continue;
      await executeFlow({ db, flow, lead: claimed, connection });
      recoveredUnstarted += 1;
    } catch (recoveryError) {
      console.error('[flow recovery] failed', { leadId: item.id, error: recoveryError.message });
      // A UazAPI confirma de forma definitiva quando o número não tem conta no
      // WhatsApp. Não deixe esse pedido preso em andamento, nem gere uma música
      // que não poderá ser entregue.
      if (/not on whatsapp|nao esta no whatsapp|não está no whatsapp/i.test(String(recoveryError.message || ''))) {
        await db.from('leads').update({
          status: 'delivery_failed',
          order_context: {
            ...(item.order_context || {}),
            flow_execution: { ...(item.order_context?.flow_execution || {}), state: 'failed', reason: 'recipient_not_on_whatsapp', failed_at: new Date().toISOString() },
            delivery_error: 'O número informado pelo site não possui WhatsApp ativo.',
          },
          updated_at: new Date().toISOString(),
        }).eq('id', item.id).eq('owner_id', item.owner_id).eq('status', 'in_progress');
      }
    }
  }
  for (const item of pending || []) {
    const execution = item.order_context?.flow_execution;
    const remarketing = item.order_context?.remarketing;
    // O site cria esta espera depois de emitir o QR Code. Somente quando os
    // 20 minutos passam sem pagamento iniciamos o fluxo configurado. O claim
    // condicional torna a rotina segura mesmo se dois crons coincidirem.
    if (execution?.remarketing_eligible_at) {
      if (item.order_context?.paid || Date.parse(execution.remarketing_eligible_at) > now) continue;
      try {
        const [{ data: flow }, { data: connection }] = await Promise.all([
          db.from('flows').select('*').eq('id', remarketing?.flow_id).eq('owner_id', item.owner_id).eq('status', 'active').maybeSingle(),
          db.from('connections').select('*').eq('id', item.connection_id).eq('owner_id', item.owner_id).eq('status', 'connected').maybeSingle(),
        ]);
        if (!flow || !connection) continue;
        const { data: claimed } = await db.from('leads').update({
          status: 'in_progress',
          order_context: {
            ...(item.order_context || {}),
            remarketing: { ...(remarketing || {}), dispatched_at: new Date().toISOString() },
            flow_execution: { flow_id: flow.id, remarketing_dispatched_at: new Date().toISOString() },
          },
          updated_at: new Date().toISOString(),
        }).eq('id', item.id).eq('owner_id', item.owner_id).eq('status', 'waiting_delay').select().maybeSingle();
        if (!claimed) continue;
        await executeFlow({ db, flow, lead: claimed, connection });
        remarketingDispatched += 1;
      } catch (remarketingError) {
        console.error('[site remarketing] dispatch failed', { leadId: item.id, error: remarketingError.message });
      }
      continue;
    }
    if (!execution?.delay_node_id || !execution.resume_at || Date.parse(execution.resume_at) > now) continue;
    if (Date.parse(execution.resume_at) < Date.parse(timeoutAt)) {
      const { data: stoppedLead } = await db.from('leads').update({ status: 'timed_out', updated_at: new Date().toISOString() }).eq('id', item.id).eq('status', 'waiting_delay').select('id').maybeSingle();
      if (stoppedLead) stopped += 1;
      continue;
    }
    const { data: lead } = await db.from('leads').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', item.id).eq('status', 'waiting_delay').select().maybeSingle();
    if (!lead) continue;
    try {
      const { data: flow } = await db.from('flows').select('*').eq('id', execution.flow_id).eq('owner_id', lead.owner_id).maybeSingle();
      const { data: connection } = await db.from('connections').select('*').eq('id', lead.connection_id).eq('owner_id', lead.owner_id).maybeSingle();
      if (!flow?.status || !connection || connection.status !== 'connected') throw new Error('Fluxo ou WhatsApp indisponivel para continuar o delay.');
      await executeFlow({ db, flow, lead, connection, resumeAfterId: execution.delay_node_id });
      resumed += 1;
    } catch (resumeError) {
      console.error('[flow delay] failed', { leadId: lead.id, error: resumeError.message });
      await db.from('leads').update({ status: 'waiting_delay', updated_at: new Date().toISOString() }).eq('id', lead.id);
    }
  }
  // A Kie pode concluir a geração sem que o callback chegue. Consultamos apenas
  // tarefas que já aguardam há dois minutos e retomamos exatamente o mesmo lead.
  const staleAt = new Date(now - 2 * 60 * 1000).toISOString();
  const { data: generating, error: generatingError } = await db.from('leads').select('*').eq('status', 'generating').lt('updated_at', staleAt).limit(25);
  if (generatingError) return NextResponse.json({ error: generatingError.message }, { status: 500 });
  for (const item of generating || []) {
    try {
      const result = await recoverKieGeneration({ db, lead: item });
      if (result.completed || result.waitingKie === false) recoveredKie += 1;
    } catch (recoverError) {
      console.error('[kie recovery] failed', { leadId: item.id, error: recoverError.message });
    }
  }
  // A Shotstack normalmente avisa quando termina, mas callbacks podem ser
  // perdidos ou chegar como evento de hospedagem. Para não travar o fluxo,
  // consultamos os vídeos pendentes e reenviamos o callback verificado.
  let recoveredLyricVideos = 0;
  const { data: pendingLyricVideos, error: pendingLyricVideosError } = await db.from('leads').select('*').eq('status', 'generating_video').lt('updated_at', staleAt).limit(25);
  if (pendingLyricVideosError) return NextResponse.json({ error: pendingLyricVideosError.message }, { status: 500 });
  for (const item of pendingLyricVideos || []) {
    const execution = item.order_context?.flow_execution;
    const callbackToken = process.env.SHOTSTACK_WEBHOOK_SECRET || process.env.DELAY_CRON_SECRET;
    if (!execution?.lyric_video_order_id || !process.env.SHOTSTACK_API_KEY || !callbackToken) continue;
    try {
      const { data: lyricOrder, error: lyricOrderError } = await db.from('lyric_video_orders').select('id,shotstack_render_id,status').eq('id', execution.lyric_video_order_id).eq('owner_id', item.owner_id).maybeSingle();
      if (lyricOrderError) throw lyricOrderError;
      if (!lyricOrder?.shotstack_render_id || lyricOrder.status !== 'rendering') continue;
      const environment = process.env.SHOTSTACK_ENVIRONMENT || 'v1';
      const renderResponse = await fetch(`https://api.shotstack.io/edit/${environment}/render/${encodeURIComponent(lyricOrder.shotstack_render_id)}`, { headers: { accept: 'application/json', 'x-api-key': process.env.SHOTSTACK_API_KEY } });
      const renderPayload = await renderResponse.json().catch(() => ({}));
      const render = renderPayload?.response;
      if (!renderResponse.ok || !render?.id) throw new Error('Não foi possível consultar o render pendente na Shotstack.');
      if (String(render.status || '').toLowerCase() !== 'done') continue;
      const callbackUrl = new URL('/api/webhooks/shotstack-lyric-video', request.url);
      callbackUrl.searchParams.set('order', lyricOrder.id);
      callbackUrl.searchParams.set('token', callbackToken);
      const callbackResponse = await fetch(callbackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'edit', id: lyricOrder.shotstack_render_id, status: 'done' }) });
      if (!callbackResponse.ok) throw new Error(`A recuperação do lyric video falhou (${callbackResponse.status}).`);
      recoveredLyricVideos += 1;
    } catch (lyricRecoveryError) {
      console.error('[lyric video recovery] failed', { leadId: item.id, error: lyricRecoveryError.message });
    }
  }
  // Uma URL temporária de áudio também pode expirar durante o envio. Tentamos
  // recuperar cada entrega falha uma única vez, respeitando as faixas já enviadas.
  let recoveredDelivery = 0;
  const { data: failedDeliveries, error: failedError } = await db.from('leads').select('*').eq('status', 'delivery_failed').limit(25);
  if (failedError) return NextResponse.json({ error: failedError.message }, { status: 500 });
  for (const item of failedDeliveries || []) {
    const recovery = item.order_context?.delivery_recovery || {};
    const execution = item.order_context?.flow_execution;
    // Falha permanente de destinatário: só uma correção do telefone no site
    // pode permitir uma nova tentativa. Evita reprocessamento automático.
    if (execution?.reason === 'recipient_not_on_whatsapp') continue;
    try {
      const [{ data: flow }, { data: originalConnection }] = await Promise.all([
        db.from('flows').select('*').eq('id', execution?.flow_id).eq('owner_id', item.owner_id).eq('status', 'active').maybeSingle(),
        db.from('connections').select('*').eq('id', item.connection_id).eq('owner_id', item.owner_id).eq('status', 'connected').maybeSingle()
      ]);
      let connection = originalConnection;
      // A entrega pode ter sido marcada como falha durante uma desconexão e a
      // conexão original ter sido removida. Só migra para o número novo quando
      // existe exatamente uma conexão ativa na mesma conta.
      if (!connection) {
        const { data: activeConnections } = await db.from('connections').select('*').eq('owner_id', item.owner_id).eq('status', 'connected').order('created_at', { ascending: false }).limit(2);
        if ((activeConnections || []).length === 1) connection = activeConnections[0];
      }
      if (!flow || !connection) continue;
      const retryAfterRecreation = !originalConnection && connection.id !== item.connection_id;
      if (Number(recovery.retry_attempts || 0) >= 1 && (!retryAfterRecreation || Number(recovery.recreation_retry_attempts || 0) >= 1)) continue;
      const values = { connection_id: connection.id, provider: connection.provider, order_context: { ...(item.order_context || {}), delivery_recovery: { ...recovery, retry_attempts: Number(recovery.retry_attempts || 0) + 1, recreation_retry_attempts: Number(recovery.recreation_retry_attempts || 0) + (retryAfterRecreation ? 1 : 0), retried_at: new Date().toISOString() } }, updated_at: new Date().toISOString() };
      let claim = db.from('leads').update(values).eq('id', item.id).eq('owner_id', item.owner_id).eq('status', 'delivery_failed');
      claim = item.connection_id ? claim.eq('connection_id', item.connection_id) : claim.is('connection_id', null);
      const { data: claimed } = await claim.select().maybeSingle();
      if (!claimed) continue;
      await retryKieDelivery({ db, flow, lead: claimed, connection });
      recoveredDelivery += 1;
    } catch (deliveryError) {
      console.error('[kie delivery recovery] failed', { leadId: item.id, error: deliveryError.message });
    }
  }
  return NextResponse.json({ received: true, resumed, remarketing_dispatched: remarketingDispatched, reengagement_templates_sent: reengagementTemplatesSent, unstarted_payment_recovered: recoveredUnstarted, kie_recovered: recoveredKie, lyric_video_recovered: recoveredLyricVideos, delivery_recovered: recoveredDelivery, timed_out: stopped, timeout_hours: timeoutHours });
}

// A Vercel chama Cron Jobs por GET. Mantemos POST para o gatilho seguro já
// usado pela instalação atual e reaproveitamos exatamente a mesma validação.
export async function GET(request) {
  return POST(request);
}
