import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow, recoverKieGeneration, retryKieDelivery } from '../../flow-engine';

export async function POST(request) {
  if (!process.env.DELAY_CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.DELAY_CRON_SECRET}`) return new NextResponse(null, { status: 401 });
  const db = adminClient();
  const now = Date.now();
  const timeoutHours = Math.max(1, Number(process.env.FLOW_EXECUTION_TIMEOUT_HOURS || 24));
  const timeoutAt = new Date(now - timeoutHours * 60 * 60 * 1000).toISOString();
  // Estas etapas deveriam avançar sem uma nova ação do cliente. Se ficarem presas,
  // encerramos somente esta execução para que ela nunca volte a enviar mensagens depois.
  const { data: expired, error: expireError } = await db.from('leads').update({ status: 'timed_out', updated_at: new Date().toISOString() }).in('status', ['in_progress', 'generating', 'delivering', 'delivery_failed', 'waiting_response', 'waiting_payment', 'waiting_pix', 'waiting_delay']).lt('updated_at', timeoutAt).select('id');
  if (expireError) return NextResponse.json({ error: expireError.message }, { status: 500 });
  const { data: pending, error } = await db.from('leads').select('*').eq('status', 'waiting_delay').limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let resumed = 0; let recoveredKie = 0; let stopped = expired?.length || 0;
  // Se uma conexão for recriada depois de uma queda da API, pedidos já pagos
  // podem ter ficado sem `connection_id` antes mesmo da primeira etapa rodar.
  // Recuperamos apenas esse caso específico: não há checkpoint, não há tarefa
  // Kie e o pedido é de geração. Isso impede repetir fluxos que já estejam
  // aguardando resposta/Pix ou que já tenham começado a gerar uma música.
  let recoveredDisconnected = 0;
  const recoveryCutoff = new Date(now - 2 * 60 * 1000).toISOString();
  const { data: orphanedPayments, error: orphanedError } = await db.from('leads')
    .select('*')
    .eq('status', 'in_progress')
    .eq('source', 'payment')
    .is('connection_id', null)
    .lt('updated_at', recoveryCutoff)
    .limit(50);
  if (orphanedError) return NextResponse.json({ error: orphanedError.message }, { status: 500 });
  for (const item of orphanedPayments || []) {
    const context = item.order_context || {};
    if (context.fulfillment_mode !== 'generate_music_in_miniflux' || context.flow_execution || item.kie_task_id) continue;
    try {
      const { data: connections } = await db.from('connections').select('*').eq('owner_id', item.owner_id).eq('status', 'connected').order('created_at', { ascending: false }).limit(2);
      // Não tentamos adivinhar entre dois números conectados: só a conexão
      // única e ativa da conta pode receber a retomada automática.
      if ((connections || []).length !== 1) continue;
      const connection = connections[0];
      const { data: config } = await db.from('connection_flow_configs').select('payment_generation_flow_id,owner_id').eq('connection_id', connection.id).maybeSingle();
      if (!config?.payment_generation_flow_id || config.owner_id !== item.owner_id) continue;
      const { data: flow } = await db.from('flows').select('*').eq('id', config.payment_generation_flow_id).eq('owner_id', item.owner_id).eq('status', 'active').maybeSingle();
      if (!flow) continue;
      const { data: claimed } = await db.from('leads').update({
        connection_id: connection.id,
        provider: connection.provider,
        order_context: { ...context, flow_execution: { flow_id: flow.id, recovered_after_disconnect_at: new Date().toISOString() } },
        updated_at: new Date().toISOString(),
      }).eq('id', item.id).is('connection_id', null).eq('status', 'in_progress').select().maybeSingle();
      if (!claimed) continue;
      await executeFlow({ db, flow, lead: claimed, connection });
      recoveredDisconnected += 1;
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
  return NextResponse.json({ received: true, resumed, disconnected_recovered: recoveredDisconnected, kie_recovered: recoveredKie, delivery_recovered: recoveredDelivery, timed_out: stopped, timeout_hours: timeoutHours });
}
